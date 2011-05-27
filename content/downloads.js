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
 * Portions created by the Initial Developer are Copyright (C) 2008-2010
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

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/DownloadUtils.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");

const nsIDownloadManager = Components.interfaces.nsIDownloadManager;
const nsITreeView = Components.interfaces.nsITreeView;

const nsLocalFile = Components.Constructor("@mozilla.org/file/local;1",
                                           "nsILocalFile", "initWithPath");

var gDownloadTree;
var gDownloadTreeView;
var gDownloadManager = Components.classes["@mozilla.org/download-manager;1"]
                                 .getService(nsIDownloadManager);
var gDownloadListener;
var gSearchBox;
var gPrefService = Components.classes["@mozilla.org/preferences-service;1"]
                             .getService(Components.interfaces.nsIPrefBranch);

function dmStartup()
{
  gDownloadTree = document.getElementById("downloadTree");
  gSearchBox = document.getElementById("search-box");

  // Add ourselves to the whitelist for disabling browser chrome.
  var win = Services.wm.getMostRecentWindow("navigator:browser");
  if (win && win.XULBrowserWindow && win.XULBrowserWindow.inContentWhitelist &&
      !win.XULBrowserWindow.inContentWhitelist.some(function(aSpec) {
          return aSpec == location;
        })) {
    win.XULBrowserWindow.inContentWhitelist.push(location.href);
  }

  // Insert as first controller on the whole window
  window.controllers.insertControllerAt(0, dlTreeController);

  // We need to keep the oview object around globally to access "local"
  // non-nsITreeView methods
  gDownloadTreeView = new DownloadTreeView(gDownloadManager);
  gDownloadTree.view = gDownloadTreeView;

  let obs = Components.classes["@mozilla.org/observer-service;1"]
                      .getService(Components.interfaces.nsIObserverService);
  obs.addObserver(gDownloadObserver, "download-manager-remove-download", false);

  // The DownloadProgressListener (DownloadProgressListener.js) handles
  // progress notifications.
  gDownloadListener = new DownloadProgressListener();
  gDownloadManager.addListener(gDownloadListener);

  gDownloadTree.focus();

  if (gDownloadTree.view.rowCount > 0)
    gDownloadTree.view.selection.select(0);
}

function dmShutdown()
{
  gDownloadManager.removeListener(gDownloadListener);
  let obs = Components.classes["@mozilla.org/observer-service;1"]
                      .getService(Components.interfaces.nsIObserverService);
  obs.removeObserver(gDownloadObserver, "download-manager-remove-download");
  window.controllers.removeController(dlTreeController);
}

function searchDownloads(aInput)
{
  gDownloadTreeView.searchView(aInput);
}

function sortDownloads(aEventTarget)
{
  var column = aEventTarget;
  var colID = column.id;
  var sortDirection = null;

  // If the target is a menuitem, handle it and forward to a column
  if (/^menu_SortBy/.test(colID)) {
    colID = colID.replace(/^menu_SortBy/, "");
    column = document.getElementById(colID);
    var sortedColumn = gDownloadTree.columns.getSortedColumn();
    if (sortedColumn && sortedColumn.id == colID)
      sortDirection = sortedColumn.element.getAttribute("sortDirection");
    else
      sortDirection = "ascending";
  }
  else if (colID == "menu_Unsorted") {
    // calling .sortView() with an "unsorted" colID returns us to original order
    colID = "unsorted";
    column = null;
    sortDirection = "ascending";
  }
  else if (colID == "menu_SortAscending" || colID == "menu_SortDescending") {
    sortDirection = colID.replace(/^menu_Sort/, "").toLowerCase();
    var sortedColumn = gDownloadTree.columns.getSortedColumn();
    if (sortedColumn) {
      colID = sortedColumn.id;
      column = sortedColumn.element;
    }
  }

  // Abort if this is still no column
  if (column && column.localName != "treecol")
    return;

  // Abort on cyler columns, we don't sort them
  if (column && column.getAttribute("cycler") == "true")
    return;

  if (!sortDirection) {
    // If not set above already, toggle the current direction
    sortDirection = column.getAttribute("sortDirection") == "ascending" ?
                    "descending" : "ascending";
  }

  // Clear attributes on all columns, we're setting them again after sorting
  for (let node = document.getElementById("Name"); node; node = node.nextSibling) {
    node.removeAttribute("sortActive");
    node.removeAttribute("sortDirection");
  }

  // Actually sort the tree view
  gDownloadTreeView.sortView(colID, sortDirection);

  if (column) {
    // Set attributes to the sorting we did
    column.setAttribute("sortActive", "true");
    column.setAttribute("sortDirection", sortDirection);
  }
}

function pauseDownload(aDownloadID)
{
  gDownloadManager.pauseDownload(aDownloadID);
}

function resumeDownload(aDownloadID)
{
  gDownloadManager.resumeDownload(aDownloadID);
}

function retryDownload(aDownloadID)
{
  gDownloadManager.retryDownload(aDownloadID);
  if (gDownloadTreeView)
    gDownloadTreeView.removeDownload(aDownloadID);
}

function cancelDownload(aDownload)
{
  gDownloadManager.cancelDownload(aDownload.id);
  // delete the file if it exists
  var file = aDownload.targetFile;
  if (file.exists())
    file.remove(false);
}

function removeDownload(aDownloadID)
{
  gDownloadManager.removeDownload(aDownloadID);
}

function openDownload(aDownload)
{
  var name = aDownload.displayName;
  var file = aDownload.targetFile;

  if (file.isExecutable()) {
    var alertOnEXEOpen = true;
    try {
      alertOnEXEOpen = gPrefService.getBoolPref("browser.download.manager.alertOnEXEOpen");
    } catch (e) { }

    // On Vista and above, we rely on native security prompting for
    // downloaded content unless it's disabled.
    try {
      var sysInfo = Components.classes["@mozilla.org/system-info;1"]
                              .getService(Components.interfaces.nsIPropertyBag2);
      if (/^Windows/.test(sysInfo.getProperty("name")) &&
          (parseFloat(sysInfo.getProperty("version")) >= 6 &&
          gPrefService.getBoolPref("browser.download.manager.scanWhenDone")))
        alertOnEXEOpen = false;
    } catch (ex) { }

    if (alertOnEXEOpen) {
      var dlbundle = document.getElementById("dmBundle");
      var message = dlbundle.getFormattedString("fileExecutableSecurityWarning", [name, name]);

      var title = dlbundle.getString("fileExecutableSecurityWarningTitle");
      var dontAsk = dlbundle.getString("fileExecutableSecurityWarningDontAsk");

      var promptSvc = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
      var checkbox = { value: false };
      var open = promptSvc.confirmCheck(window, title, message, dontAsk, checkbox);

      if (!open)
        return;
      gPrefService.setBoolPref("browser.download.manager.alertOnEXEOpen", !checkbox.value);
    }
  }

  try {
    var mimeInfo = aDownload.MIMEInfo;
    if (mimeInfo && mimeInfo.preferredAction == mimeInfo.useHelperApp) {
      mimeInfo.launchWithFile(file);
      return;
    }
  } catch (ex) { }

  try {
    file.launch();
  } catch (ex) {
    // If launch fails, try sending it through the system's external
    // file: URL handler
    var uri = Components.classes["@mozilla.org/network/io-service;1"]
                        .getService(Components.interfaces.nsIIOService)
                        .newFileURI(file);
    var protocolSvc = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
                                .getService(Components.interfaces.nsIExternalProtocolService);
    protocolSvc.loadUrl(uri);
  }
}

function showDownload(aDownload)
{
  var file = aDownload.targetFile;

  try {
    // Show the directory containing the file and select the file
    file.reveal();
  } catch (e) {
    // If reveal fails for some reason (e.g., it's not implemented on unix or
    // the file doesn't exist), try using the parent if we have it.
    var parent = file.parent.QueryInterface(Components.interfaces.nsILocalFile);

    try {
      // "Double click" the parent directory to show where the file should be
      parent.launch();
    } catch (e) {
      // If launch also fails (probably because it's not implemented), let the
      // OS handler try to open the parent
      var uri = Components.classes["@mozilla.org/network/io-service;1"]
                          .getService(Components.interfaces.nsIIOService)
                          .newFileURI(parent);
      var protocolSvc = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
                                  .getService(Components.interfaces.nsIExternalProtocolService);
      protocolSvc.loadUrl(uri);
    }
  }
}

function showProperties(aDownloadID)
{
  var dmui = Components.classes["@mozilla.org/download-manager-ui;1"]
                       .getService(Components.interfaces.nsIKDownloadManagerUI);
  dmui.showProgress(window, aDownloadID);
}

function onTreeSelect(aEvent)
{
  document.commandDispatcher.updateCommands("tree-select");
}

function onUpdateViewColumns(aMenuItem)
{
  while (aMenuItem) {
    // Each menuitem should be checked if its column is not hidden.
    var colID = aMenuItem.id.replace(/^menu_Toggle/, "");
    var column = document.getElementById(colID);
    aMenuItem.setAttribute("checked", !column.hidden);
    aMenuItem = aMenuItem.nextSibling;
  }
}

function toggleColumn(aMenuItem)
{
  var colID = aMenuItem.id.replace(/^menu_Toggle/, "");
  var column = document.getElementById(colID);
  column.setAttribute("hidden", !column.hidden);
}

function onUpdateViewSort(aMenuItem)
{
  var unsorted = true;
  var ascending = true;
  while (aMenuItem) {
    switch (aMenuItem.id) {
      case "": // separator
        break;
      case "menu_Unsorted":
        if (unsorted) // this would work even if Unsorted was last
          aMenuItem.setAttribute("checked", "true");
        break;
      case "menu_SortAscending":
        aMenuItem.setAttribute("disabled", unsorted);
        if (!unsorted && ascending)
          aMenuItem.setAttribute("checked", "true");
        break;
      case "menu_SortDescending":
        aMenuItem.setAttribute("disabled", unsorted);
        if (!unsorted && !ascending)
          aMenuItem.setAttribute("checked", "true");
        break;
      default:
        var colID = aMenuItem.id.replace(/^menu_SortBy/, "");
        var column = document.getElementById(colID);
        var direction = column.getAttribute("sortDirection");
        if (column.getAttribute("sortActive") == "true" && direction) {
          // We've found a sorted column. Remember its direction.
          ascending = direction == "ascending";
          unsorted = false;
          aMenuItem.setAttribute("checked", "true");
        }
    }
    aMenuItem = aMenuItem.nextSibling;
  }
}

// This is called by the progress listener.
var gLastComputedMean = -1;
var gLastActiveDownloads = 0;
function onUpdateProgress()
{
  var numActiveDownloads = gDownloadManager.activeDownloadCount;

  // Use the default title and reset "last" values if there's no downloads
  if (numActiveDownloads == 0) {
    document.title = document.documentElement.getAttribute("statictitle");
    gLastComputedMean = -1;
    gLastActiveDownloads = 0;

    return;
  }

  // Establish the mean transfer speed and amount downloaded.
  var mean = 0;
  var base = 0;
  var dls = gDownloadManager.activeDownloads;
  while (dls.hasMoreElements()) {
    var dl = dls.getNext().QueryInterface(Components.interfaces.nsIDownload);
    if (dl.percentComplete < 100 && dl.size > 0) {
      mean += dl.amountTransferred;
      base += dl.size;
    }
  }

  // Calculate the percent transferred, unless we don't have a total file size
  var dlbundle = document.getElementById("dmBundle");
  if (base != 0)
    mean = Math.floor((mean / base) * 100);

  // Update title of window
  if (mean != gLastComputedMean || gLastActiveDownloads != numActiveDownloads) {
    gLastComputedMean = mean;
    gLastActiveDownloads = numActiveDownloads;

    var title;
    if (base == 0)
      title = dlbundle.getFormattedString("downloadsTitleFiles",
                                          [numActiveDownloads]);
    else
      title = dlbundle.getFormattedString("downloadsTitlePercent",
                                          [numActiveDownloads, mean]);

    // Get the correct plural form and insert number of downloads and percent
    title = PluralForm.get(numActiveDownloads, title);

    document.title = title;
  }
}

// -- copied from downloads.js: getLocalFileFromNativePathOrUrl()
// we should be using real URLs all the time, but until
// bug 239948 is fully fixed, this will do...
//
// note, this will thrown an exception if the native path
// is not valid (for example a native Windows path on a Mac)
// see bug #392386 for details
function getLocalFileFromNativePathOrUrl(aPathOrUrl)
{
  if (/^file:\/\//.test(aPathOrUrl)) {
    // if this is a URL, get the file from that
    var ioSvc = Components.classes["@mozilla.org/network/io-service;1"].
                getService(Components.interfaces.nsIIOService);

    const fileUrl = ioSvc.newURI(aPathOrUrl, null, null).
                    QueryInterface(Components.interfaces.nsIFileURL);
    return fileUrl.file.clone().QueryInterface(Components.interfaces.nsILocalFile);
  } else {
    // if it's a pathname, create the nsILocalFile directly
    var f = new nsLocalFile(aPathOrUrl);

    return f;
  }
}

var gDownloadObserver = {
  observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "download-manager-remove-download":
        if (aSubject instanceof Components.interfaces.nsISupportsPRUint32)
          // We have a single download.
          gDownloadTreeView.removeDownload(aSubject.data);
        else
          // A null subject here indicates "remove multiple", so we just rebuild.
          gDownloadTreeView.initTree();
      break;
    }
  }
};

var dlTreeController = {
  supportsCommand: function(aCommand)
  {
    switch (aCommand) {
      case "cmd_play":
      case "cmd_pause":
      case "cmd_resume":
      case "cmd_retry":
      case "cmd_cancel":
      case "cmd_delete":
      case "cmd_open":
      case "cmd_show":
      case "cmd_openReferrer":
      case "cmd_copy":
      case "cmd_copyLocation":
      case "cmd_properties":
      case "cmd_selectAll":
      case "cmd_clearList":
        return true;
    }
    return false;
  },

  isCommandEnabled: function(aCommand)
  {
    var selectionCount = 0;
    if (gDownloadTreeView && gDownloadTreeView.selection)
      selectionCount = gDownloadTreeView.selection.count;

    var selItemData = [];
    if (selectionCount) {
      // walk all selected rows
      let start = {};
      let end = {};
      let numRanges = gDownloadTreeView.selection.getRangeCount();
      for (let rg = 0; rg < numRanges; rg++) {
        gDownloadTreeView.selection.getRangeAt(rg, start, end);
        for (let row = start.value; row <= end.value; row++)
          selItemData.push(gDownloadTreeView.getRowData(row));
      }
    }

    switch (aCommand) {
      case "cmd_play":
        if (!selectionCount)
          return false;
        for each (let dldata in selItemData) {
          if (dldata.state != nsIDownloadManager.DOWNLOAD_CANCELED &&
              dldata.state != nsIDownloadManager.DOWNLOAD_FAILED &&
              (!dldata.resumable ||
               (!dldata.isActive &&
                dldata.state != nsIDownloadManager.DOWNLOAD_PAUSED)))
            return false;
        }
        return true;
      case "cmd_pause":
        if (!selectionCount)
          return false;
        for each (let dldata in selItemData) {
          if (!dldata.isActive ||
              dldata.state == nsIDownloadManager.DOWNLOAD_PAUSED ||
              !dldata.resumable)
            return false;
        }
        return true;
      case "cmd_resume":
        if (!selectionCount)
          return false;
        for each (let dldata in selItemData) {
          if (dldata.state != nsIDownloadManager.DOWNLOAD_PAUSED ||
              !dldata.resumable)
            return false;
        }
        return true;
      case "cmd_open":
      case "cmd_show":
        // we can't reveal until the download is complete, because we have not given
        // the file its final name until them.
        return selectionCount == 1 &&
               selItemData[0].state == nsIDownloadManager.DOWNLOAD_FINISHED &&
               getLocalFileFromNativePathOrUrl(selItemData[0].file).exists();
      case "cmd_cancel":
        if (!selectionCount)
          return false;
        for each (let dldata in selItemData) {
          if (!dldata.isActive)
            return false;
        }
        return true;
      case "cmd_retry":
        if (!selectionCount)
          return false;
        for each (let dldata in selItemData) {
          if (dldata.state != nsIDownloadManager.DOWNLOAD_CANCELED &&
              dldata.state != nsIDownloadManager.DOWNLOAD_FAILED)
            return false;
        }
        return true;
      case "cmd_remove":
        if (!selectionCount)
          return false;
        for each (let dldata in selItemData) {
          if (dldata.isActive)
            return false;
        }
        return true;
      case "cmd_openReferrer":
        return selectionCount == 1 && !!selItemData[0].referrer;
      case "cmd_delete":
      case "cmd_copy":
      case "cmd_copyLocation":
        return selectionCount > 0;
      case "cmd_properties":
        return selectionCount == 1;
      case "cmd_selectAll":
        return gDownloadTreeView.rowCount != selectionCount;
      case "cmd_clearList":
        return gDownloadTreeView.rowCount && gDownloadManager.canCleanUp;
      default:
        return false;
    }
  },

  doCommand: function(aCommand) {
    var selectionCount = 0;
    if (gDownloadTreeView && gDownloadTreeView.selection)
      selectionCount = gDownloadTreeView.selection.count;

    var selItemData = [];
    if (selectionCount) {
      // walk all selected rows
      let start = {};
      let end = {};
      let numRanges = gDownloadTreeView.selection.getRangeCount();
      for (let rg = 0; rg < numRanges; rg++) {
        gDownloadTreeView.selection.getRangeAt(rg, start, end);
        for (let row = start.value; row <= end.value; row++)
          selItemData.push(gDownloadTreeView.getRowData(row));
      }
    }

    switch (aCommand) {
      case "cmd_play":
        for each (let dldata in selItemData) {
          switch (dldata.state) {
            case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
              pauseDownload(dldata.dlid);
              break;
            case nsIDownloadManager.DOWNLOAD_PAUSED:
              resumeDownload(dldata.dlid);
              break;
            case nsIDownloadManager.DOWNLOAD_FAILED:
            case nsIDownloadManager.DOWNLOAD_CANCELED:
              retryDownload(dldata.dlid);
              break;
          }
        }
        break;
      case "cmd_pause":
        for each (let dldata in selItemData)
          pauseDownload(dldata.dlid);
        break;
      case "cmd_resume":
        for each (let dldata in selItemData)
          resumeDownload(dldata.dlid);
        break;
      case "cmd_retry":
        for each (let dldata in selItemData)
          retryDownload(dldata.dlid);
        break;
      case "cmd_cancel":
        for each (let dldata in selItemData)
          // fake an nsIDownload with the properties needed by that function
          cancelDownload({id: dldata.dlid,
                          targetFile: getLocalFileFromNativePathOrUrl(dldata.file)});
        break;
      case "cmd_remove":
        for each (let dldata in selItemData)
          removeDownload(dldata.dlid);
        break;
      case "cmd_delete":
        for each (let dldata in selItemData) {
          if (dldata.isActive)
            // fake an nsIDownload with the properties needed by that function
            cancelDownload({id: dldata.dlid,
                            targetFile: getLocalFileFromNativePathOrUrl(dldata.file)});
          else
            removeDownload(dldata.dlid);
        }
        break;
      case "cmd_open":
        openDownload(gDownloadManager.getDownload(selItemData[0].dlid));
        break;
      case "cmd_show":
        // fake an nsIDownload with the properties needed by that function
        showDownload({targetFile: getLocalFileFromNativePathOrUrl(selItemData[0].file)});
        break;
      case "cmd_openReferrer":
        openURL(selItemData[0].referrer);
        break;
      case "cmd_copy":
      case "cmd_copyLocation":
        var clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
        var uris = [];
        for each (let dldata in selItemData)
          uris.push(dldata.uri);
        clipboard.copyString(uris.join("\n"));
        break;
      case "cmd_properties":
        showProperties(selItemData[0].dlid);
        break;
      case "cmd_selectAll":
        gDownloadTreeView.selection.selectAll();
        break;
      case "cmd_clearList":
        // Clear the whole list if there's no search
        if (gSearchBox.value == "") {
          gDownloadManager.cleanUp();
          return;
        }

        // Remove each download starting from the end until we hit a download
        // that is in progress
        for (let idx = gDownloadTreeView.rowCount - 1; idx >= 0; idx--) {
          let dldata = gDownloadTreeView.getRowData(idx);
          if (!dldata.isActive) {
            removeDownload(dldata.dlid);
          }
        }

        // Clear the input as if the user did it and move focus to the list
        gSearchBox.value = "";
        searchDownloads("");
        gDownloadTree.focus();
        break;
    }
  },

  onEvent: function(aEvent){
    switch (aEvent) {
    case "tree-select":
      this.onCommandUpdate();
    }
  },

  onCommandUpdate: function() {
    var cmds = ["cmd_play", "cmd_pause", "cmd_resume", "cmd_retry",
                "cmd_cancel", "cmd_remove", "cmd_delete", "cmd_open", "cmd_show",
                "cmd_openReferrer", "cmd_copyLocation", "cmd_properties",
                "cmd_selectAll", "cmd_clearList", "cmd_copy"];
    for (let command in cmds)
      goUpdateCommand(cmds[command]);
  }
};

function DownloadTreeView(aDownloadManager) {
  this._dm = aDownloadManager;
  this._dlList = [];
  this._searchTerms = [];
}

DownloadTreeView.prototype = {
  QueryInterface: XPCOMUtils.generateQI([nsITreeView]),

  // ***** nsITreeView attributes and methods *****
  get rowCount() {
    return this._dlList.length;
  },

  selection: null,

  getRowProperties: function(aRow, aProperties) {
    var dl = this._dlList[aRow];
    var atomService = Components.classes["@mozilla.org/atom-service;1"]
                                .getService(Components.interfaces.nsIAtomService);
    // (in)active
    var activeAtom = atomService.getAtom(dl.isActive ? "active": "inactive");
    aProperties.AppendElement(activeAtom);
    // resumable
    if (dl.resumable)
      aProperties.AppendElement(atomService.getAtom("resumable"));
    // Download states
    switch (dl.state) {
      case nsIDownloadManager.DOWNLOAD_PAUSED:
        aProperties.AppendElement(atomService.getAtom("paused"));
        break;
      case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
        aProperties.AppendElement(atomService.getAtom("downloading"));
        break;
      case nsIDownloadManager.DOWNLOAD_FINISHED:
        aProperties.AppendElement(atomService.getAtom("finished"));
        break;
      case nsIDownloadManager.DOWNLOAD_FAILED:
        aProperties.AppendElement(atomService.getAtom("failed"));
        break;
      case nsIDownloadManager.DOWNLOAD_CANCELED:
        aProperties.AppendElement(atomService.getAtom("canceled"));
        break;
      case nsIDownloadManager.DOWNLOAD_BLOCKED_PARENTAL: // Parental Controls
      case nsIDownloadManager.DOWNLOAD_BLOCKED_POLICY:   // Security Zone Policy
      case nsIDownloadManager.DOWNLOAD_DIRTY:            // possible virus/spyware
        aProperties.AppendElement(atomService.getAtom("blocked"));
        break;
    }
  },
  getCellProperties: function(aRow, aColumn, aProperties) {
    // Append all row properties to the cell
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
    if (aColumn.id == "Name")
      return "moz-icon://" + this._dlList[aRow].file + "?size=16";
    return "";
  },

  getProgressMode: function(aRow, aColumn) {
    if (aColumn.id == "Progress") {
      var dl = this._dlList[aRow];
      if (dl.isActive)
        return (dl.maxBytes >= 0) ? nsITreeView.PROGRESS_NORMAL :
                                    nsITreeView.PROGRESS_UNDETERMINED;
    }
    return nsITreeView.PROGRESS_NONE;
  },

  getCellValue: function(aRow, aColumn) {
    if (aColumn.id == "Progress")
      return this._dlList[aRow].progress;
    return "";
  },

  getCellText: function(aRow, aColumn) {
    var dl = this._dlList[aRow];
    switch (aColumn.id) {
      case "Name":
        return dl.target;
      case "Domain":
        return dl.domain;
      case "Status":
        switch (dl.state) {
          case nsIDownloadManager.DOWNLOAD_PAUSED:
            return this._dlbundle.getString("paused");
          case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
            return this._dlbundle.getString("downloading");
          case nsIDownloadManager.DOWNLOAD_FINISHED:
            return this._dlbundle.getString("finished");
          case nsIDownloadManager.DOWNLOAD_FAILED:
            return this._dlbundle.getString("failed");
          case nsIDownloadManager.DOWNLOAD_CANCELED:
            return this._dlbundle.getString("canceled");
          case nsIDownloadManager.DOWNLOAD_BLOCKED_PARENTAL: // Parental Controls
          case nsIDownloadManager.DOWNLOAD_BLOCKED_POLICY:   // Security Zone Policy
          case nsIDownloadManager.DOWNLOAD_DIRTY:            // possible virus/spyware
            return this._dlbundle.getString("blocked");
        }
        return this._dlbundle.getString("notStarted");
      case "Progress":
        if (dl.isActive)
          return dl.progress;
        switch (dl.state) {
          case nsIDownloadManager.DOWNLOAD_FINISHED:
            return this._dlbundle.getString("finished");
          case nsIDownloadManager.DOWNLOAD_FAILED:
            return this._dlbundle.getString("failed");
          case nsIDownloadManager.DOWNLOAD_CANCELED:
            return this._dlbundle.getString("canceled");
          case nsIDownloadManager.DOWNLOAD_BLOCKED_PARENTAL: // Parental Controls
          case nsIDownloadManager.DOWNLOAD_BLOCKED_POLICY:   // Security Zone Policy
          case nsIDownloadManager.DOWNLOAD_DIRTY:            // possible virus/spyware
            return this._dlbundle.getString("blocked");
        }
        return this._dlbundle.getString("notStarted");
      case "ProgressPercent":
        return dl.progress;
      case "TimeRemaining":
        if (dl.isActive) {
          var dld = this._dm.getDownload(dl.dlid);
          var lastSec = (dl.lastSec == null) ? Infinity : dl.lastSec;
          // Calculate the time remaining if we have valid values
          var seconds = (dld.speed > 0) && (dl.maxBytes > 0)
                        ? (dl.maxBytes - dl.currBytes) / dld.speed
                        : -1;
          var [timeLeft, newLast] = DownloadUtils.getTimeLeft(seconds, lastSec);
          this._dlList[aRow].lastSec = newLast;
          return timeLeft;
        }
        return "";
      case "Transferred":
        return DownloadUtils.getTransferTotal(dl.currBytes, dl.maxBytes);
      case "TransferRate":
        switch (dl.state) {
          case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
            var speed = this._dm.getDownload(dl.dlid).speed;
            this._dlList[aRow]._speed = speed; // used for sorting
            var [rate, unit] = DownloadUtils.convertByteUnits(speed);
            return this._dlbundle.getFormattedString("speedFormat", [rate, unit]);
          case nsIDownloadManager.DOWNLOAD_PAUSED:
            return this._dlbundle.getString("paused");
          case nsIDownloadManager.DOWNLOAD_NOTSTARTED:
          case nsIDownloadManager.DOWNLOAD_QUEUED:
            return this._dlbundle.getString("notStarted");
        }
        return "";
      case "TimeElapsed":
        if (dl.endTime && dl.startTime && (dl.endTime > dl.startTime)) {
          var seconds = (dl.endTime - dl.startTime) / 1000;
          var [time1, unit1, time2, unit2] =
            DownloadUtils.convertTimeUnits(seconds);
          if (seconds < 3600 || time2 == 0)
            return this._dlbundle.getFormattedString("timeSingle", [time1, unit1]);
          return this._dlbundle.getFormattedString("timeDouble", [time1, unit1, time2, unit2]);
        }
        return "";
      case "StartTime":
        if (dl.startTime)
          return this._convertTimeToString(dl.startTime);
        return "";
      case "EndTime":
        if (dl.endTime)
          return this._convertTimeToString(dl.endTime);
        return "";
      case "FullPath":
        return getLocalFileFromNativePathOrUrl(dl.file).path;
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
  cycleCell: function(aRow, aColumn) {
    var dl = this._dlList[aRow];
    switch (aColumn.id) {
      case "ActionPlay":
        switch (dl.state) {
          case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
            pauseDownload(dl.dlid);
            break;
          case nsIDownloadManager.DOWNLOAD_PAUSED:
            resumeDownload(dl.dlid);
            break;
          case nsIDownloadManager.DOWNLOAD_FAILED:
          case nsIDownloadManager.DOWNLOAD_CANCELED:
            retryDownload(dl.dlid);
            break;
        }
        break;
      case "ActionStop":
        if (dl.isActive)
          // fake an nsIDownload with the properties needed by that function
          cancelDownload({id: dl.dlid,
                          targetFile: getLocalFileFromNativePathOrUrl(dl.file)});
        else
          removeDownload(dl.dlid);
        break;
    }
  },
  isEditable: function(aRow, aColumn) { return false; },
  isSelectable: function(aRow, aColumn) { return false; },
  setCellValue: function(aRow, aColumn, aText) { },
  setCellText: function(aRow, aColumn, aText) { },
  performAction: function(aAction) { },
  performActionOnRow: function(aAction, aRow) { },
  performActionOnCell: function(aAction, aRow, aColumn) { },

  // ***** local public methods *****

  addDownload: function(aDownload) {
    var attrs = {
      dlid: aDownload.id,
      file: aDownload.target.spec,
      target: aDownload.displayName,
      uri: aDownload.source.spec,
      state: aDownload.state,
      progress: aDownload.percentComplete,
      resumable: aDownload.resumable,
      startTime: Math.round(aDownload.startTime / 1000),
      endTime: Date.now(),
      referrer: null,
      currBytes: aDownload.amountTransferred,
      maxBytes: aDownload.size,
      lastSec: Infinity, // For calculations of remaining time
    };
    try {
      attrs.domain = aDownload.source.host;
    }
    catch (e) { }
    if (!attrs.domain)
      attrs.domain = aDownload.source.prePath;
    switch (attrs.state) {
      case nsIDownloadManager.DOWNLOAD_NOTSTARTED:
      case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
      case nsIDownloadManager.DOWNLOAD_PAUSED:
      case nsIDownloadManager.DOWNLOAD_QUEUED:
      case nsIDownloadManager.DOWNLOAD_SCANNING:
        attrs.isActive = 1;
        break;
      default:
        attrs.isActive = 0;
        break;
    }

    // prepend in natural sorting
    attrs.listIndex = this._lastListIndex--;

    // Prepend data to the download list
    this._dlList.unshift(attrs);

    // Tell the tree we added 1 row at index 0
    this._tree.rowCountChanged(0, 1);

    // Data has changed, so re-sorting might be needed
    this.sortView("", "", attrs, 0);

    document.commandDispatcher.updateCommands("tree-select");
  },

  updateDownload: function(aDownload) {
    var row = this._getIdxForID(aDownload.id);
    if (row == -1) {
      // No download row found to update, but as it's obviously going on,
      // add it to the list now (can happen with very fast, e.g. local dls)
      this.addDownload(aDownload);
      return;
    }
    var dl = this._dlList[row];
    if (dl.currBytes != aDownload.amountTransferred) {
      dl.endTime = Date.now();
      dl.currBytes = aDownload.amountTransferred;
      dl.maxBytes = aDownload.size;
      dl.progress = aDownload.percentComplete;
    }
    if (dl.state != aDownload.state) {
      dl.state = aDownload.state;
      dl.resumable = aDownload.resumable;
      switch (dl.state) {
        case nsIDownloadManager.DOWNLOAD_NOTSTARTED:
        case nsIDownloadManager.DOWNLOAD_DOWNLOADING:
        case nsIDownloadManager.DOWNLOAD_PAUSED:
        case nsIDownloadManager.DOWNLOAD_QUEUED:
        case nsIDownloadManager.DOWNLOAD_SCANNING:
          dl.isActive = 1;
          break;
        default:
          dl.isActive = 0;
          break;
      }
      // We should eventually know the referrer at some point
      var referrer = aDownload.referrer;
      if (referrer)
        dl.referrer = referrer.spec;
    }

    // Repaint the tree row
    this._tree.invalidateRow(row);

    // Data has changed, so re-sorting might be needed
    this.sortView("", "", dl, row);

    document.commandDispatcher.updateCommands("tree-select");
  },

  removeDownload: function(aDownloadID) {
    var row = this._getIdxForID(aDownloadID);
    // Make sure we have an item to remove
    if (row < 0) return;

    var index = this.selection.currentIndex;
    var wasSingleSelection = this.selection.count == 1;

    // Remove data from the download list
    this._dlList.splice(row, 1);

    // Tell the tree we removed 1 row at the given row index
    this._tree.rowCountChanged(row, -1);

    // Update selection if only removed download was selected
    if (wasSingleSelection && this.selection.count == 0) {
      index = Math.min(index, this.rowCount - 1);
      if (index >= 0)
        this.selection.select(index);
    }

    document.commandDispatcher.updateCommands("tree-select");
  },

  initTree: function() {
    if (!this._tree)
      return
    // We're resetting the whole list, either because we're creating the tree
    // or because we need to recreate it
    this._tree.beginUpdateBatch();
    this._dlList = [];

    this.selection.clearSelection();

    // Sort as they should appear while loading and in unsorted list.
    this._statement = this._dm.DBConnection.createStatement(
      "SELECT id, target, name, source, state, startTime, endTime, referrer, " +
            "currBytes, maxBytes, state IN (?1, ?2, ?3, ?4, ?5) AS isActive " +
      "FROM moz_downloads " +
      "ORDER BY isActive DESC, endTime DESC, startTime DESC, id ASC");

    this._statement.bindInt32Parameter(0, nsIDownloadManager.DOWNLOAD_NOTSTARTED);
    this._statement.bindInt32Parameter(1, nsIDownloadManager.DOWNLOAD_DOWNLOADING);
    this._statement.bindInt32Parameter(2, nsIDownloadManager.DOWNLOAD_PAUSED);
    this._statement.bindInt32Parameter(3, nsIDownloadManager.DOWNLOAD_QUEUED);
    this._statement.bindInt32Parameter(4, nsIDownloadManager.DOWNLOAD_SCANNING);

    let loaderInstance;
    function nextStep() {
      loaderInstance.next();
    }
    function loader(aDTV) {
      let loadCount = 0;
      while (aDTV._statement.executeStep()) {
        // Try to get the attribute values from the statement
        let attrs = {
          dlid: aDTV._statement.getInt64(0),
          file: aDTV._statement.getString(1),
          target: aDTV._statement.getString(2),
          uri: aDTV._statement.getString(3),
          state: aDTV._statement.getInt32(4),
          startTime: Math.round(aDTV._statement.getInt64(5) / 1000),
          endTime: Math.round(aDTV._statement.getInt64(6) / 1000),
          referrer: aDTV._statement.getString(7),
          currBytes: aDTV._statement.getInt64(8),
          maxBytes: aDTV._statement.getInt64(9),
          lastSec: Infinity, // For calculations of remaining time
        };
        let sourceURI = Services.io.newURI(attrs.uri, null, null);
        try {
          attrs.domain = sourceURI.host;
        }
        catch (e) { }
        if (!attrs.domain)
          attrs.domain = sourceURI.prePath;

        // If active, grab real progress, otherwise default to 100.
        attrs.isActive = aDTV._statement.getInt32(10);
        if (attrs.isActive) {
          let dld = aDTV._dm.getDownload(attrs.dlid);
          attrs.progress = dld.percentComplete;
          attrs.resumable = dld.resumable;
        }
        else {
          attrs.progress = 100;
          attrs.resumable = false;
        }

        // Only actually add item to tree if it's active or matching search.

        let matchSearch = true;
        if (aDTV._searchTerms) {
          // Search through the download attributes that are shown to the user and
          // make it into one big string for easy combined searching.
          // XXX: toolkit uses the target, status and dateTime attributes of their XBL item
          let combinedSearch = attrs.file.toLowerCase() + " " + attrs.uri.toLowerCase();
          if (attrs.target)
            combinedSearch = combinedSearch + " " + attrs.target.toLowerCase();

          if (!attrs.isActive)
            for each (let term in aDTV._searchTerms)
              if (combinedSearch.indexOf(term) == -1)
                matchSearch = false;
        }

        // matchSearch is always true for active downloads, see above
        if (matchSearch) {
          aDTV._dlList.push(attrs);
        }
        loadCount++;
        // Make sure not to yield before active downloads are in the list,
        // but do so a few times afterwards to allow interaction while loading.
        if (!attrs.isActive && loadCount % 10 == 0) {
          aDTV._tree.endUpdateBatch();
          yield setTimeout(nextStep, 0);
          aDTV._tree.beginUpdateBatch();
        }
      }
      aDTV._tree.endUpdateBatch();
      yield setTimeout(nextStep, 0);

      // Loop in reverse to get continuous list indexes with increasing
      // negative numbers for default-sort in ascending order.
      this._lastListIndex = 0;
      for (let i = aDTV._dlList.length - 1; i >= 0; i--)
        aDTV._dlList[i].listIndex = aDTV._lastListIndex--;

      aDTV._statement.reset();
      // Find sorted column and sort the tree.
      aDTV._tree.beginUpdateBatch();
      var sortedColumn = aDTV._tree.columns.getSortedColumn();
      if (sortedColumn) {
        var direction = sortedColumn.element.getAttribute("sortDirection");
        aDTV.sortView(sortedColumn.id, direction);
      }
      aDTV._tree.endUpdateBatch();

      document.commandDispatcher.updateCommands("tree-select");
      yield setTimeout(nextStep, 0);

      // Send a notification that we finished.
      Services.obs.notifyObservers(window, "download-manager-ui-done", null);
      yield;
    }
    loaderInstance = loader(this);
    setTimeout(nextStep, 0);
  },

  searchView: function(aInput) {
    // Stringify the previous search
    var prevSearch = this._searchTerms.join(" ");

    // Array of space-separated lower-case search terms
    this._searchTerms = aInput.trim().toLowerCase().split(/\s+/);

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

  sortView: function(aColumnID, aDirection, aDownload, aRow) {
    var sortAscending = aDirection != "descending";

    if (aColumnID == "" && aDirection == "") {
      // Re-sort in already selected/cached order
      var sortedColumn = this._tree.columns.getSortedColumn();
      if (sortedColumn) {
        aColumnID = sortedColumn.id;
        sortAscending = sortedColumn.element.getAttribute("sortDirection") != "descending";
      }
      // no need for else, use default case of switch, sortAscending is true
    }

    // Compare function for two _dlList items
    var compfunc = function(a, b) {
      // Active downloads are always at the beginning
      // i.e. 0 for .isActive is larger (!) than 1
      if (a.isActive < b.isActive)
        return 1;
      if (a.isActive > b.isActive)
        return -1;
      // Same active/inactive state, sort normally
      var comp_a = null;
      var comp_b = null;
      switch (aColumnID) {
        case "Name":
          comp_a = a.target.toLowerCase();
          comp_b = b.target.toLowerCase();
          break;
        case "Domain":
          comp_a = a.domain.toLowerCase();
          comp_b = b.domain.toLowerCase();
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
        case "StartTime":
          comp_a = a.startTime;
          comp_b = b.startTime;
          break;
        case "EndTime":
          comp_a = a.endTime;
          comp_b = b.endTime;
          break;
        case "FullPath":
          comp_a = getLocalFileFromNativePathOrUrl(a.file).path;
          comp_b = getLocalFileFromNativePathOrUrl(b.file).path;
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

    var row = this._dlList.indexOf(aDownload);
    if (row == -1)
      // Repaint the tree
      this._tree.invalidate();
    else if (row == aRow)
      // No effect
      this._selectionCache = null;
    else if (row < aRow)
      // Download moved up from aRow to row
      this._tree.invalidateRange(row, aRow);
    else
      // Download moved down from aRow to row
      this._tree.invalidateRange(aRow, row)

    // Restore the selection
    this._restoreSelection();
  },

  getRowData: function(aRow) {
    return this._dlList[aRow];
  },

  // ***** local member vars *****

  _tree: null,
  _dlBundle: null,
  _statement: null,
  _lastListIndex: 0,
  _selectionCache: null,
  __dateService: null,

  // ***** local helper functions *****

  get _dateService() {
    if (!this.__dateService) {
      this.__dateService = Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
                                     .getService(Components.interfaces.nsIScriptableDateFormat);
    }
    return this.__dateService;
  },

  // Get array index in _dlList for a given download ID
  _getIdxForID: function(aDlID) {
    var len = this._dlList.length;
    for (let idx = 0; idx < len; idx++) {
      if (this._dlList[idx].dlid == aDlID)
        return idx;
    }
    return -1;
  },

  // Cache IDs of selected downloads for later restoration
  _cacheSelection: function() {
    // Abort if there's already something cached
    if (this._selectionCache)
      return;

    this._selectionCache = [];
    if (this.selection.count < 1)
      return;

    // Walk all selected rows and cache theior download IDs
    var start = {};
    var end = {};
    var numRanges = this.selection.getRangeCount();
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
    if (!this._selectionCache)
      return;

    this.selection.clearSelection();
    for each (let dlid in this._selectionCache) {
      // Find out what row this is now and if possible, add it to the selection
      var row = this._getIdxForID(dlid);
      if (row != -1)
        this.selection.rangedSelect(row, row, true);
    }
    // Work done, clear the cache
    this._selectionCache = null;
  },

  _convertTimeToString: function(aTime) {
    var timeObj = new Date(aTime);

    // Check if it is today and only display the time.  Only bother
    // checking for today if it's within the last 24 hours, since
    // computing midnight is not really cheap. Sometimes we may get dates
    // in the future, so always show those.
    var ago = Date.now() - aTime;
    var dateFormat = Components.interfaces.nsIScriptableDateFormat.dateFormatShort;
    if (ago > -10000 && ago < (1000 * 24 * 60 * 60)) {
      var midnight = new Date();
      midnight.setHours(0);
      midnight.setMinutes(0);
      midnight.setSeconds(0);
      midnight.setMilliseconds(0);

      if (aTime > midnight.getTime())
        dateFormat = Components.interfaces.nsIScriptableDateFormat.dateFormatNone;
    }

    return (this._dateService.FormatDateTime("", dateFormat,
      Components.interfaces.nsIScriptableDateFormat.timeFormatNoSeconds,
      timeObj.getFullYear(), timeObj.getMonth() + 1,
      timeObj.getDate(), timeObj.getHours(),
      timeObj.getMinutes(), timeObj.getSeconds()));
  },

};

var gDownloadDNDObserver = {
  onDragStart: function (aEvent)
  {
    if (!gDownloadTreeView ||
        !gDownloadTreeView.selection ||
        !gDownloadTreeView.selection.count)
      return;

    var selItemData = gDownloadTreeView.getRowData(gDownloadTree.currentIndex);
    var file = getLocalFileFromNativePathOrUrl(selItemData.file);

    if (!file.exists())
      return;

    var url = Services.io.newFileURI(file).spec;
    var dt = aEvent.dataTransfer;
    dt.mozSetDataAt("application/x-moz-file", file, 0);
    dt.setData("text/uri-list", url + "\r\n");
    dt.setData("text/plain", url + "\n");
    dt.effectAllowed = "copyMove";
  },

  onDragOver: function (aEvent)
  {
    var types = aEvent.dataTransfer.types;
    // Exclude x-moz-file as we don't need to download local files,
    // and those could be from ourselves.
    if (!types.contains("application/x-moz-file") &&
        (types.contains("text/uri-list") ||
         types.contains("text/x-moz-url") ||
         types.contains("text/plain")))
      aEvent.preventDefault();
    aEvent.stopPropagation();
  },

  onDrop: function(aEvent)
  {
    var dt = aEvent.dataTransfer;
    var url = dt.getData("URL");
    var name;
    if (!url) {
      url = dt.getData("text/x-moz-url") || dt.getData("text/plain");
      [url, name] = url.split("\n");
    }
    if (url)
      saveURL(url, name, null, true, true);
  }
};

/**
 * DownloadProgressListener "class" is used to help update download items shown
 * in the Download Manager UI such as displaying amount transferred, transfer
 * rate, and time left for each download.
 *
 * This class implements the nsIDownloadProgressListener interface.
 */
function DownloadProgressListener() {}

DownloadProgressListener.prototype = {
  //////////////////////////////////////////////////////////////////////////////
  //// nsISupports

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIDownloadProgressListener]),

  //////////////////////////////////////////////////////////////////////////////
  //// nsIDownloadProgressListener

  onDownloadStateChange: function(aState, aDownload) {
    // Update window title in-case we don't get all progress notifications
    onUpdateProgress();

    switch (aDownload.state) {
      case nsIDownloadManager.DOWNLOAD_QUEUED:
        gDownloadTreeView.addDownload(aDownload);
        break;

      case nsIDownloadManager.DOWNLOAD_BLOCKED_POLICY:
        gDownloadTreeView.addDownload(aDownload);
        // Should fall through, this is a final state but DOWNLOAD_QUEUED
        // is skipped. See nsDownloadManager::AddDownload.
      default:
        gDownloadTreeView.updateDownload(aDownload);
        break;
    }
  },

  onProgressChange: function(aWebProgress, aRequest,
                             aCurSelfProgress, aMaxSelfProgress,
                             aCurTotalProgress, aMaxTotalProgress, aDownload) {
    gDownloadTreeView.updateDownload(aDownload);

    // Update window title
    onUpdateProgress();
  },

  onStateChange: function(aWebProgress, aRequest, aState, aStatus, aDownload) {
  },

  onSecurityChange: function(aWebProgress, aRequest, aState, aDownload) {
  }
};
