/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the SeaMonkey internet suite code.
 *
 * The Initial Developer of the Original Code is
 * the SeaMonkey project at mozilla.org.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Robert Kaiser <kairo@kairo.at>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/DownloadUtils.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");

var nsIDM = Components.interfaces.nsIDownloadManager;
var nsITreeView = Components.interfaces.nsITreeView;

function DownloadTreeView(aDownloadManager) {
  this._tree = null;
  this._selection = null;
  this._dm = aDownloadManager;
  this._dlBundle = null;
  this._statement = null;
  this._dlList = [];
  this._lastListIndex = 0;
  this._listSortCol = "";
  this._listSortAsc = null;
  this._searchTerms = [];
  this._selectionCache = [];
}

DownloadTreeView.prototype = {
  QueryInterface: function(aIID) {
    if (aIID.equals(nsITreeView) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  // ***** nsITreeView attributes and methods *****
  get rowCount() {
    return this._dlList.length;
  },

  get selection() {
    return this._selection;
  },

  set selection(val) {
    return this._selection = val;
  },

  getRowProperties: function(aRow, aProperties) {
    let dl = this._dlList[aRow];
    let atomService = Components.classes["@mozilla.org/atom-service;1"]
                                .getService(Components.interfaces.nsIAtomService);
    // active/notActive
    let activeAtom = atomService.getAtom(dl.isActive ? "active": "notActive");
    aProperties.AppendElement(activeAtom);
    // download states
    switch (dl.state) {
      case nsIDM.DOWNLOAD_PAUSED:
        aProperties.AppendElement(atomService.getAtom("paused"));
        break;
      case nsIDM.DOWNLOAD_DOWNLOADING:
        aProperties.AppendElement(atomService.getAtom("downloading"));
        break;
      case nsIDM.DOWNLOAD_FINISHED:
        aProperties.AppendElement(atomService.getAtom("finished"));
        break;
      case nsIDM.DOWNLOAD_FAILED:
        aProperties.AppendElement(atomService.getAtom("failed"));
        break;
      case nsIDM.DOWNLOAD_CANCELED:
        aProperties.AppendElement(atomService.getAtom("canceled"));
        break;
      case nsIDM.DOWNLOAD_BLOCKED_PARENTAL: // Parental Controls
      case nsIDM.DOWNLOAD_BLOCKED_POLICY:   // Security Zone Policy
      case nsIDM.DOWNLOAD_DIRTY:            // possible virus/spyware
        aProperties.AppendElement(atomService.getAtom("blocked"));
        break;
    }
  },
  getCellProperties: function(aRow, aColumn, aProperties) {
    //append all row properties to the cell
    this.getRowProperties(aRow, aProperties);
  },
  getColumnProperties: function(aColumn, aProperties) { },
  isContainer: function(aRow) { return false; },
  isContainerOpen: function(aRow) { return false; },
  isContainerEmpty: function(aRow) { return false; },
  isSeparator: function(aRow) { return false; },
  isSorted: function() { return false; },
  canDrop: function(aIdx, aOrientation) { return false; },
  drop: function(aIdx, aOrientation) { },
  getParentIndex: function(aRow) { return -1; },
  hasNextSibling: function(aRow, aAfterIdx) { return false; },
  getLevel: function(aRow) { return 0; },

  getImageSrc: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "Name":
        return "moz-icon://" + this._dlList[aRow].file + "?size=16";
    }
    return "";
  },

  getProgressMode: function(aRow, aColumn) {
    let dl = this._dlList[aRow];
    switch (aColumn.id) {
      case "Progress":
        if (dl.isActive)
          return (dl.maxBytes >= 0) ? nsITreeView.PROGRESS_NORMAL
                                    : nsITreeView.PROGRESS_UNDETERMINED;
        else
          return nsITreeView.PROGRESS_NONE;
    }
    return nsITreeView.PROGRESS_NONE;
  },

  getCellValue: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "Progress":
        return this._dlList[aRow].progress;
    }
    return "";
  },

  getCellText: function(aRow, aColumn) {
    let dl = this._dlList[aRow];
    switch (aColumn.id) {
      case "Name":
        let file = getLocalFileFromNativePathOrUrl(dl.file);
        return file.nativeLeafName || file.leafName;
      case "Status":
        switch (dl.state) {
          case nsIDM.DOWNLOAD_PAUSED:
            return this._dlbundle.getFormattedString("pausedpct",
              [DownloadUtils.getTransferTotal(dl.currBytes,
                                              dl.maxBytes)]);
          case nsIDM.DOWNLOAD_DOWNLOADING:
            return this._dlbundle.getString("downloading");
          case nsIDM.DOWNLOAD_FINISHED:
            return this._dlbundle.getString("finished");
          case nsIDM.DOWNLOAD_FAILED:
            return this._dlbundle.getString("failed");
          case nsIDM.DOWNLOAD_CANCELED:
            return this._dlbundle.getString("canceled");
          case nsIDM.DOWNLOAD_BLOCKED_PARENTAL: // Parental Controls
          case nsIDM.DOWNLOAD_BLOCKED_POLICY:   // Security Zone Policy
          case nsIDM.DOWNLOAD_DIRTY:            // possible virus/spyware
            return this._dlbundle.getString("blocked");
        }
        return this._dlbundle.getString("notStarted");
      case "Progress":
        if (dl.isActive)
          return dl.progress;
        switch (dl.state) {
          case nsIDM.DOWNLOAD_FINISHED:
            return this._dlbundle.getString("finished");
          case nsIDM.DOWNLOAD_FAILED:
            return this._dlbundle.getString("failed");
          case nsIDM.DOWNLOAD_CANCELED:
            return this._dlbundle.getString("canceled");
          case nsIDM.DOWNLOAD_BLOCKED_PARENTAL: // Parental Controls
          case nsIDM.DOWNLOAD_BLOCKED_POLICY:   // Security Zone Policy
          case nsIDM.DOWNLOAD_DIRTY:            // possible virus/spyware
            return this._dlbundle.getString("blocked");
        }
        return this._dlbundle.getString("notStarted");
      case "ProgressPercent":
        return dl.progress;
      case "TimeRemaining":
        if (dl.isActive) {
          let dld = this._dm.getDownload(dl.dlid);
          let maxBytes = (dl.maxBytes == null) ? -1 : dl.maxBytes;
          let speed = (dld.speed == null) ? -1 : dld.speed;
          let lastSec = (dl.lastSec == null) ? Infinity : dl.lastSec;
          // Calculate the time remaining if we have valid values
          let seconds = (speed > 0) && (maxBytes > 0)
                        ? (maxBytes - dl.currBytes) / speed
                        : -1;
          let [timeLeft, newLast] = DownloadUtils.getTimeLeft(seconds, lastSec);
          this._dlList[aRow].lastSec = newLast;
          return timeLeft;
        }
        return "";
      case "Transferred":
        return DownloadUtils.getTransferTotal(dl.currBytes, dl.maxBytes);
      case "TransferRate":
        switch (dl.state) {
          case nsIDM.DOWNLOAD_DOWNLOADING:
            let speed = this._dm.getDownload(dl.dlid).speed;
            this._dlList[aRow]._speed = speed; // used for sorting
            let [rate, unit] = DownloadUtils.convertByteUnits(speed);
            return this._dlbundle.getFormattedString("speedFormat", [rate, unit]);
          case nsIDM.DOWNLOAD_PAUSED:
            return this._dlbundle.getString("paused");
          case nsIDM.DOWNLOAD_NOTSTARTED:
          case nsIDM.DOWNLOAD_QUEUED:
            return this._dlbundle.getString("notStarted");
        }
        return "";
      case "TimeElapsed":
        if (dl.endTime && dl.startTime && (dl.endTime > dl.startTime)) {
          let seconds = (dl.endTime - dl.startTime) / 1000;
          let [time1, unit1, time2, unit2] =
            DownloadUtils.convertTimeUnits(seconds);
          if (seconds < 3600 || time2 == 0)
            return this._dlbundle.getFormattedString("timeSingle", [time1, unit1]);
          return this._dlbundle.getFormattedString("timeDouble", [time1, unit1, time2, unit2]);
        }
        return "";
      case "Source":
        return dl.uri;
    }
    return "";
  },

  setTree: function(aTree) {
    this._tree = aTree;
    this._dlbundle = document.getElementById("dmBundle");

    this.initTree();
  },

  toggleOpenState: function(aRow) { },
  cycleHeader: function(aColumn) { },
  selectionChanged: function() { },
  cycleCell: function(aRow, aColumn) { },
  isEditable: function(aRow, aColumn) { return false; },
  isSelectable: function(aRow, aColumn) { return false; },
  setCellValue: function(aRow, aColumn, aText) { },
  setCellText: function(aRow, aColumn, aText) { },
  performAction: function(aAction) { },
  performActionOnRow: function(aAction, aRow) { },
  performActionOnCell: function(aAction, aRow, aColumn) { },

  // ***** local public methods *****

  addDownload: function(aDownload) {
    let attrs = {
      dlid: aDownload.id,
      file: aDownload.target.spec,
      target: aDownload.displayName,
      uri: aDownload.source.spec,
      state: aDownload.state,
      progress: aDownload.percentComplete,
      startTime: Math.round(aDownload.startTime / 1000),
      endTime: Date.now(),
      currBytes: aDownload.amountTransferred,
      maxBytes: aDownload.size
    };
    switch (attrs.state) {
      case nsIDM.DOWNLOAD_NOTSTARTED:
      case nsIDM.DOWNLOAD_DOWNLOADING:
      case nsIDM.DOWNLOAD_PAUSED:
      case nsIDM.DOWNLOAD_QUEUED:
      case nsIDM.DOWNLOAD_SCANNING:
        attrs.isActive = 1;
        break;
      default:
        attrs.isActive = 0;
        break;
    }
    // Init lastSec for calculations of remaining time
    attrs.lastSec = Infinity;

    // prepend in natural sorting
    attrs.listIndex = this._lastListIndex--;

    // Prepend data to the download list
    this._dlList.unshift(attrs);

    // Tell the tree we added 1 row at index 0
    this._tree.rowCountChanged(0, 1);

    // Update the selection
    this.selection.adjustSelection(0, 1);

    // Data has changed, so re-sorting might be needed
    this.sortView("", "");
  },

  updateDownload: function(aDownload) {
    let row = this._getIdxForID(aDownload.id);
    if (this._dlList[row].currBytes != aDownload.amountTransferred) {
      this._dlList[row].endTime = Date.now();
      this._dlList[row].currBytes = aDownload.amountTransferred;
      this._dlList[row].maxBytes = aDownload.size;
      this._dlList[row].progress = aDownload.percentComplete;
    }
    if (this._dlList[row].state != aDownload.state) {
      this._dlList[row].state = aDownload.state;
      switch (this._dlList[row].state) {
        case nsIDM.DOWNLOAD_NOTSTARTED:
        case nsIDM.DOWNLOAD_DOWNLOADING:
        case nsIDM.DOWNLOAD_PAUSED:
        case nsIDM.DOWNLOAD_QUEUED:
        case nsIDM.DOWNLOAD_SCANNING:
          this._dlList[row].isActive = 1;
          break;
        default:
          this._dlList[row].isActive = 0;
          break;
      }
      // We should eventually know the referrer at some point
      let referrer = aDownload.referrer;
      if (referrer)
        this._dlList[row].referrer = referrer.spec;
    }

    // Repaint the tree row
    this._tree.invalidateRow(row);

    // Data has changed, so re-sorting might be needed
    this.sortView("", "");
  },

  removeDownload: function(aDownloadID) {
    let row = this._getIdxForID(aDownloadID);
    // Make sure we have an item to remove
    if (row < 0) return;

    // Remove data from the download list
    this._dlList.splice(row, 1);

    // Tell the tree we removed 1 row at the given row index
    this._tree.rowCountChanged(row, -1);

    // Update the selection
    this.selection.adjustSelection(row, -1);

    window.updateCommands("tree-select");
  },

  initTree: function() {
    // We're resetting the whole list, either because we're creating the tree
    // or because we need to recreate it
    this._tree.beginUpdateBatch();
    this._dlList = [];
    this._lastListIndex = 0;
    this._listSortCol = "";
    this._listSortAsc = null;

    this.selection.clearSelection();

    this._statement = this._dm.DBConnection.createStatement(
      "SELECT id, target, name, source, state, startTime, endTime, referrer, " +
            "currBytes, maxBytes, state IN (?1, ?2, ?3, ?4, ?5) isActive " +
      "FROM moz_downloads " +
      "ORDER BY isActive DESC, endTime DESC, startTime DESC");

    this._statement.bindInt32Parameter(0, nsIDM.DOWNLOAD_NOTSTARTED);
    this._statement.bindInt32Parameter(1, nsIDM.DOWNLOAD_DOWNLOADING);
    this._statement.bindInt32Parameter(2, nsIDM.DOWNLOAD_PAUSED);
    this._statement.bindInt32Parameter(3, nsIDM.DOWNLOAD_QUEUED);
    this._statement.bindInt32Parameter(4, nsIDM.DOWNLOAD_SCANNING);

    while (this._statement.executeStep()) {
      // Try to get the attribute values from the statement
      let attrs = {
        dlid: this._statement.getInt64(0),
        file: this._statement.getString(1),
        target: this._statement.getString(2),
        uri: this._statement.getString(3),
        state: this._statement.getInt32(4),
        startTime: Math.round(this._statement.getInt64(5) / 1000),
        endTime: Math.round(this._statement.getInt64(6) / 1000),
        currBytes: this._statement.getInt64(8),
        maxBytes: this._statement.getInt64(9)
      };

      // Only add the referrer if it's not null
      let (referrer = this._statement.getString(7)) {
        if (referrer)
          attrs.referrer = referrer;
      }

      // If the download is active, grab the real progress, otherwise default 100
      attrs.isActive = this._statement.getInt32(10);
      attrs.progress = attrs.isActive
                         ? this._dm.getDownload(attrs.dlid).percentComplete
                         : 100;
      // Init lastSec for calculations of remaining time
      attrs.lastSec = Infinity;

      // Only actually add item to the tree if it's active or matching search

      // Search through the download attributes that are shown to the user and
      // make it into one big string for easy combined searching
      // XXX: toolkit uses the target, status and dateTime attributes of the XBL item
      let combinedSearch = attrs.file.toLowerCase() + " " + attrs.uri.toLowerCase();

      let matchSearch = true;
      for each (let term in this._searchTerms)
        if (combinedSearch.search(term) == -1)
          matchSearch = false;

      if (attrs.isActive || matchSearch) {
        attrs.listIndex = this._lastListIndex++;
        this._dlList.push(attrs);
      }
    }
    this._statement.reset();
    this._lastListIndex = 0; // we'll prepend other downloads with --!
    // find sorted column and sort the tree
    let sortedColumn = this._tree.columns.getSortedColumn();
    if (sortedColumn) {
      let direction = sortedColumn.element.getAttribute("sortDirection");
      this.sortView(sortedColumn.id, direction);
    }
    else {
      // set cache values to default "unsorted" order
      this._listSortCol = "unsorted";
      this._listSortAsc = true;
    }
    this._tree.endUpdateBatch();

    window.updateCommands("tree-select");
  },

  searchView: function(aInput) {
    // Stringify the previous search
    let prevSearch = this._searchTerms.join(" ");

    // Array of space-separated lower-case search terms
    this._searchTerms = aInput.replace(/^\s+|\s+$/g, "")
                              .toLowerCase().split(/\s+/);

    // Don't rebuild the download list if the search didn't change
    if (this._searchTerms.join(" ") == prevSearch)
      return;

    // Cache the current selection
    this._cacheSelection();

    // Rebuild the tree with set search terms
    this.initTree();

    // Restore the selection
    this._restoreSelection();
  },

  sortView: function(aColumnID, aDirection) {
    let sortAscending = aDirection == "ascending";

    if (aColumnID == "" && aDirection == "" && this._listSortCol != "") {
      // Re-sort in already selected/cached order
      aColumnID = this._listSortCol;
      sortAscending = this._listSortAsc;
    }

    // Compare function for two _dlList items
    let compfunc = function(a, b) {
      // Active downloads are always at the beginning
      // i.e. 0 for .isActive is larger (!) than 1
      if (a.isActive < b.isActive)
        return 1;
      if (a.isActive > b.isActive)
        return -1;
      // Same active/inactive state, sort normally
      let comp_a = null;
      let comp_b = null;
      switch (aColumnID) {
        case "Name":
          comp_a = a.target.toLowerCase();
          comp_b = b.target.toLowerCase();
          break;
        case "Status":
          comp_a = a.state;
          comp_b = b.state;
          break;
        case "Progress":
        case "ProgressPercent":
          // Use original sorting for inactive entries
          // Use only one isActive to be sure we do the same
          comp_a = a.isActive ? a.progress : a.listIndex;
          comp_b = a.isActive ? b.progress : b.listIndex;
          break;
        case "TimeRemaining":
          comp_a = a.isActive ? a.lastSec : a.listIndex;
          comp_b = a.isActive ? b.lastSec : b.listIndex;
          break;
        case "Transferred":
          comp_a = a.currBytes;
          comp_b = b.currBytes;
          break;
        case "TransferRate":
          comp_a = a.isActive ? a._speed : a.listIndex;
          comp_b = a.isActive ? b._speed : b.listIndex;
          break;
        case "TimeElapsed":
          comp_a = (a.endTime && a.startTime && (a.endTime > a.startTime))
                   ? a.endTime - a.startTime
                   : 0;
          comp_b = (b.endTime && b.startTime && (b.endTime > b.startTime))
                   ? b.endTime - b.startTime
                   : 0;
          break;
        case "Source":
          comp_a = a.uri;
          comp_b = b.uri;
          break;
        case "unsorted": // Special case for reverting to original order
        default:
          comp_a = a.listIndex;
          comp_b = b.listIndex;
      }
      if (comp_a > comp_b)
        return sortAscending ? 1 : -1;
      if (comp_a < comp_b)
        return sortAscending ? -1 : 1;
      return 0;
    }

    // Cache the current selection
    this._cacheSelection();

    // Do the actual sorting of the array
    this._dlList.sort(compfunc);

    // Cache column and direction for re-sorting
    this._listSortCol = aColumnID;
    this._listSortAsc = sortAscending;

    // Repaint the tree
    this._tree.invalidate();

    // Restore the selection
    this._restoreSelection();
  },

  getRowData: function(aRow) {
    return this._dlList[aRow];
  },

  // ***** local helper functions *****

  // Get array index in _dlList for a given download ID
  _getIdxForID: function(aDlID) {
    let len = this._dlList.length;
    for (let idx = 0; idx < len; idx++) {
      if (idx in this._dlList &&
          this._dlList[idx].dlid === aDlID)
        return idx;
    }
    return -1;
  },

  // Cache IDs of selected downloads for later restoration
  _cacheSelection: function() {
    // Abort if there's already something cached
    if (this._selectionCache.length)
      return;

    this._selectionCache = [];
    if (this.selection.count < 1)
      return;

    // Walk all selected rows and cache theior download IDs
    let start = new Object();
    let end = new Object();
    let numRanges = this.selection.getRangeCount();
    for (let rg = 0; rg < numRanges; rg++){
      this.selection.getRangeAt(rg, start, end);
      for (let row = start.value; row <= end.value; row++){
        this._selectionCache.push(this._dlList[row].dlid);
      }
    }
  },

  // Restore selection from cached IDs (as possible)
  _restoreSelection: function() {
    // Abort if the cache is empty
    if (!this._selectionCache.length)
      return;

    this.selection.clearSelection();
    let row;
    for each (let dlid in this._selectionCache) {
      // Find out what row this is now and if possible, add it to the selection
      row = this._getIdxForID(dlid);
      if (row != -1)
        this.selection.rangedSelect(row, row, true);
    }
    // Work done, clear the cache
    this._selectionCache = [];
  },

};
