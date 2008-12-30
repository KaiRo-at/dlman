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

function DownloadTreeView() { }

DownloadTreeView.prototype = {
  QueryInterface: function(aIID) {
    if (aIID.equals(nsITreeView) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  // nsITreeView attributes
  get rowCount() {
    return this._dlList.length;
  },

  get selection() {
    return this._selection;
  },

  set selection(val) {
    return this._selection = val;
  },

  // nsITreeView methods
  getRowProperties: function(aIdx, aProperties) { },
  getCellProperties: function(aRow, aColumn, aProperties) { },
  getColumnProperties: function(aColumn, aProperties) { },
  isContainer: function(aIdx) { return false; },
  isContainerOpen: function(aIdx) { return false; },
  isContainerEmpty: function(aIdx) { return false; },
  isSeparator: function(aIdx) { return false; },
  isSorted: function() { return false; },
  canDrop: function(aIdx, aOrientation) { return false; },
  drop: function(aIdx, aOrientation) { },
  getParentIndex: function(aRow) { return -1; },
  hasNextSibling: function(aRow, aAfterIdx) { return false; },
  getLevel: function(aIdx) { return 0; },

  getImageSrc: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "Name":
        return "moz-icon://" + this._dlList[aRow].file + "?size=16"
    }
    return "";
  },

  getProgressMode: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "Progress":
        return dl.isActive ? nsITreeView.PROGRESS_NORMAL
                           : nsITreeView.PROGRESS_NONE;
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
        let file = this._getLocalFileFromNativePathOrUrl(dl.file);
        return file.nativePath || file.path;
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
        return dl.endTime;
      case "Transferred":
        return dl.currBytes + " of " + dl.maxBytes;
      case "TransferRate":
        return "";
      case "TimeElapsed":
        return dl.startTime;
      case "Source":
        return dl.uri;
    }
    return "";
  },

  setTree: function(aTree) {
    this._tree = aTree;
    this._dlbundle = document.getElementById("dmBundle");
    this._dm = Components.classes["@mozilla.org/download-manager;1"]
                         .createInstance(nsIDM);
    this._dlList = [];

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

      this._dlList.push(attrs);
    }
    this._statement.reset();
    // Send a notification that we finished, but wait for clear list to update
    //  updateClearListButton();
    //  setTimeout(function() Cc["@mozilla.org/observer-service;1"].
    //    getService(Ci.nsIObserverService).
    //    notifyObservers(window, "download-manager-ui-done", null), 0);
  },

  toggleOpenState: function(aIdx) { },
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

  // local helper functions

  // -- copied from downloads.js: getLocalFileFromNativePathOrUrl()
  // we should be using real URLs all the time, but until
  // bug 239948 is fully fixed, this will do...
  //
  // note, this will thrown an exception if the native path
  // is not valid (for example a native Windows path on a Mac)
  // see bug #392386 for details
  _getLocalFileFromNativePathOrUrl: function(aPathOrUrl) {
    if (aPathOrUrl.substring(0,7) == "file://") {
      // if this is a URL, get the file from that
      let ioSvc = Components.classes["@mozilla.org/network/io-service;1"].
                  getService(Components.interfaces.nsIIOService);

      // XXX it's possible that using a null char-set here is bad
      const fileUrl = ioSvc.newURI(aPathOrUrl, null, null).
                      QueryInterface(Components.interfaces.nsIFileURL);
      return fileUrl.file.clone().QueryInterface(Components.interfaces.nsILocalFile);
    } else {
      // if it's a pathname, create the nsILocalFile directly
      var f = new nsLocalFile(aPathOrUrl);

      return f;
    }
  },

};
