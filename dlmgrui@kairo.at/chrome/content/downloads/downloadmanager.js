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

let nsIDM = Components.interfaces.nsIDownloadManager;

let gDownloadTree;
let gDownloadTreeView;
let gDownloadManager = Components.classes["@mozilla.org/download-manager;1"]
                                 .createInstance(nsIDM);
let gDownloadStatus;
let gDownloadListener;
let gSearchBox;
let gPrefService = Components.classes["@mozilla.org/preferences-service;1"]
                             .getService(Components.interfaces.nsIPrefBranch);

function DownloadsInit()
{
  gDownloadTree = document.getElementById("downloadTree");
  gDownloadStatus = document.getElementById("statusbar-display");
  gSearchBox = document.getElementById("search-box");
  let clearListButton = document.getElementById("clearListButton");

  // We need to keep the oview object around globally to access "local"
  // non-nsITreeView methods
  gDownloadTreeView = new DownloadTreeView(gDownloadManager);
  gDownloadTree.view = gDownloadTreeView;

  // Append controller on all our interactive controls
  gDownloadTree.controllers.appendController(dlTreeController);
  gSearchBox.controllers.appendController(dlTreeController);
  clearListButton.controllers.appendController(dlTreeController);

  // The DownloadProgressListener (DownloadProgressListener.js) handles
  // progress notifications.
  gDownloadListener = new DownloadProgressListener();
  gDownloadManager.addListener(gDownloadListener);

  searchDownloads("");

  if (gDownloadStatus)
    gDownloadTree.focus();

  if (gDownloadTree.view.rowCount > 0)
    gDownloadTree.view.selection.select(0);
}

function DownloadsShutdown()
{
  gDownloadManager.removeListener(gDownloadListener);
}

function searchDownloads(aInput)
{
  gDownloadTreeView.searchView(aInput);
}

function sortDownloads(aEventTarget)
{
  dump("XXX: sort is not implemented yet!\n");
  //gDownloadTree.load();
}

// This is called by the progress listener.
let gLastComputedMean = -1;
let gLastActiveDownloads = 0;
function onUpdateProgress()
{
  let numActiveDownloads = gDownloadManager.activeDownloadCount;

  // Use the default title and reset "last" values if there's no downloads
  if (numActiveDownloads == 0) {
    document.title = document.documentElement.getAttribute("statictitle");
    gLastComputedMean = -1;
    gLastActiveDownloads = 0;

    return;
  }

  // Establish the mean transfer speed and amount downloaded.
  let mean = 0;
  let base = 0;
  let dls = gDownloadManager.activeDownloads;
  while (dls.hasMoreElements()) {
    let dl = dls.getNext().QueryInterface(Components.interfaces.nsIDownload);
    if (dl.percentComplete < 100 && dl.size > 0) {
      mean += dl.amountTransferred;
      base += dl.size;
    }
  }

  // Calculate the percent transferred, unless we don't have a total file size
  let dlbundle = document.getElementById("dmBundle");
  let title = dlbundle.getString("downloadsTitlePercent");
  if (base == 0)
    title = dlbundle.getString("downloadsTitleFiles");
  else
    mean = Math.floor((mean / base) * 100);

  // Update title of window
  if (mean != gLastComputedMean || gLastActiveDownloads != numActiveDownloads) {
    gLastComputedMean = mean;
    gLastActiveDownloads = numActiveDownloads;

    // Get the correct plural form and insert number of downloads and percent
    title = PluralForm.get(numActiveDownloads, title);
    title = replaceInsert(title, 1, numActiveDownloads);
    title = replaceInsert(title, 2, mean);

    document.title = title;
  }
}

function openDownload(aDownloadData)
{
  let file = getLocalFileFromNativePathOrUrl(aDownloadData.file);
  if (file.isExecutable()) {
    let alertOnEXEOpen = true;
    try {
      alertOnEXEOpen = gPrefService.getBoolPref("browser.download.manager.alertOnEXEOpen");
    } catch (e) { }

    // On Vista and above, we rely on native security prompting for
    // downloaded content.
    try {
      let sysInfo = Components.classes["@mozilla.org/system-info;1"]
                              .getService(Components.interfaces.nsIPropertyBag2);
      if (/^Windows/.match(sysInfo.getProperty("name")) &&
          (parseFloat(sysInfo.getProperty("version")) >= 6))
        alertOnEXEOpen = false;
    } catch (ex) { }

    if (alertOnEXEOpen) {
      let dlbundle = document.getElementById("dmBundle");
      let name = aDownloadData.target;
      let message = dlbundle.getFormattedString("fileExecutableSecurityWarning", [name, name]);

      let title = dlbundle.getString("fileExecutableSecurityWarningTitle");
      let dontAsk = dlbundle.getString("fileExecutableSecurityWarningDontAsk");

      let promptSvc = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
      let checkbox = { value: false };
      let open = promptSvc.confirmCheck(window, title, message, dontAsk, checkbox);

      if (!open)
        return;
      gPrefService.setBoolPref("browser.download.manager.alertOnEXEOpen", !checkbox.value);
    }
  }
  try {
    file.launch();
  } catch (ex) {
    // If launch fails, try sending it through the system's external
    // file: URL handler
    let uri = Components.classes["@mozilla.org/network/io-service;1"]
                        .getService(Components.interfaces.nsIIOService)
                        .newFileURI(file);
    let protocolSvc = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
                                .getService(Components.interfaces.nsIExternalProtocolService);
    protocolSvc.loadUrl(uri);
  }
}

function showDownload(aDownloadData)
{
  var file = getLocalFileFromNativePathOrUrl(aDownloadData.file);

  try {
    // Show the directory containing the file and select the file
    file.reveal();
  } catch (e) {
    // If reveal fails for some reason (e.g., it's not implemented on unix or
    // the file doesn't exist), try using the parent if we have it.
    let parent = file.parent.QueryInterface(Components.interfaces.nsILocalFile);
    if (!parent)
      return;

    try {
      // "Double click" the parent directory to show where the file should be
      parent.launch();
    } catch (e) {
      // If launch also fails (probably because it's not implemented), let the
      // OS handler try to open the parent
      openExternal(parent);
    }
  }
}

function onSelect(aEvent) {
  var selectionCount = gDownloadTreeView.selection.count;
  if (selectionCount == 1) {
    let selItemData = gDownloadTreeView.getRowData(gDownloadTree.currentIndex);
    let file = getLocalFileFromNativePathOrUrl(selItemData.file);
    gDownloadStatus.label = file.path;
  } else
    gDownloadStatus.label = "";

  window.updateCommands("tree-select");
}

// -- copied from downloads.js: getLocalFileFromNativePathOrUrl()
// we should be using real URLs all the time, but until
// bug 239948 is fully fixed, this will do...
//
// note, this will thrown an exception if the native path
// is not valid (for example a native Windows path on a Mac)
// see bug #392386 for details
function getLocalFileFromNativePathOrUrl(aPathOrUrl) {
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
}

/**
 * Helper function to replace a placeholder string with a real string
 *
 * @param aText
 *        Source text containing placeholder (e.g., #1)
 * @param aIndex
 *        Index number of placeholder to replace
 * @param aValue
 *        New string to put in place of placeholder
 * @return The string with placeholder replaced with the new string
 */
function replaceInsert(aText, aIndex, aValue)
{
  return aText.replace("#" + aIndex, aValue);
}

let dlTreeController = {
  supportsCommand: function(aCommand)
  {
    switch (aCommand) {
      case "cmd_pause":
      case "cmd_resume":
      case "cmd_retry":
      case "cmd_cancel":
      case "cmd_remove":
      case "cmd_open":
      case "cmd_show":
      case "cmd_openReferrer":
      case "cmd_copyLocation":
      case "cmd_selectAll":
      case "cmd_clearList":
        return true;
    }
    return false;
  },

  isCommandEnabled: function(aCommand)
  {
    // we can even enable some commands when we have no selection
    let ignoreSelection = (aCommand == "cmd_selectAll" ||
                           aCommand == "cmd_clearList");

    let selectionCount = 0;
    if (gDownloadTreeView && gDownloadTreeView.selection)
      selectionCount = gDownloadTreeView.selection.count;
    if (!ignoreSelection && !selectionCount) return false;

    let selItemData = selectionCount
                      ? gDownloadTreeView.getRowData(gDownloadTree.currentIndex)
                      : null;

    let download = null; // used for getting an nsIDownload object

    switch (aCommand) {
      case "cmd_pause":
        download = gDownloadManager.getDownload(selItemData.dlid);
        return selectionCount == 1 &&
               selItemData.isActive &&
               selItemData.state != nsIDM.DOWNLOAD_PAUSED &&
               download.resumable;
      case "cmd_resume":
        download = gDownloadManager.getDownload(selItemData.dlid);
        return selectionCount == 1 &&
               selItemData.state == nsIDM.DOWNLOAD_PAUSED &&
               download.resumable;
      case "cmd_open":
      case "cmd_show":
        // we can't reveal until the download is complete, because we have not given
        // the file its final name until them.
        let file = getLocalFileFromNativePathOrUrl(selItemData.file);
        return selectionCount == 1 &&
               selItemData.state == nsIDM.DOWNLOAD_FINISHED &&
               file.exists();
      case "cmd_cancel":
        // XXX handling multiple selection would be nice
        return selectionCount == 1 && selItemData.isActive;
      case "cmd_retry":
      case "cmd_remove":
        return selectionCount == 1 &&
               (selItemData.state == nsIDM.DOWNLOAD_FINISHED ||
                selItemData.state == nsIDM.DOWNLOAD_CANCELED ||
                selItemData.state == nsIDM.DOWNLOAD_BLOCKED_PARENTAL ||
                selItemData.state == nsIDM.DOWNLOAD_BLOCKED_POLICY ||
                selItemData.state == nsIDM.DOWNLOAD_DIRTY ||
                selItemData.state == nsIDM.DOWNLOAD_FAILED);
      case "cmd_openReferrer":
        return selectionCount == 1 && !!selItemData.referrer;
      case "cmd_copyLocation":
        return true;
      case "cmd_selectAll":
        return gDownloadTreeView.rowCount != selectionCount;
      case "cmd_clearList":
        return gDownloadTreeView.rowCount > 0;
      default:
        return false;
    }
  },

  doCommand: function(aCommand){
    // we can even enable some commands when we have no selection
    let ignoreSelection = (aCommand == "cmd_selectAll" ||
                           aCommand == "cmd_clearList");

    let selectionCount = 0;
    if (gDownloadTreeView && gDownloadTreeView.selection)
      selectionCount = gDownloadTreeView.selection.count;
    let selIdx = selectionCount == 1 ? gDownloadTree.currentIndex : -1;
    let selItemData = selectionCount == 1 ? gDownloadTreeView.getRowData(selIdx) : null;

    let m_selIdx = [selIdx];
    if (selectionCount > 1) {
      m_selIdx = [];
      // walk all selected rows
      let start = new Object();
      let end = new Object();
      let numRanges = gDownloadTreeView.selection.getRangeCount();
      for (let rg = 0; rg < numRanges; rg++){
        gDownloadTreeView.selection.getRangeAt(rg, start, end);
        for (let row = start.value; row <= end.value; row++){
          m_selIdx.push(row);
        }
      }
    }

    switch (aCommand) {
      case "cmd_pause":
        gDownloadManager.pauseDownload(selItemData.dlid);
        break;
      case "cmd_resume":
        gDownloadManager.resumeDownload(selItemData.dlid);
        break;
      case "cmd_retry":
        gDownloadManager.retryDownload(selItemData.dlid);
        gDownloadTreeView.removeTreeRow(selIdx);
        break;
      case "cmd_cancel":
        gDownloadManager.cancelDownload(selItemData.dlid);
        // delete the file if it exists
        let file = getLocalFileFromNativePathOrUrl(selItemData.file);
        if (file.exists())
          file.remove(false);
        break;
      case "cmd_remove":
        gDownloadManager.removeDownload(selItemData.dlid);
        gDownloadTreeView.removeTreeRow(selIdx);
        break;
      case "cmd_open":
        openDownload(selItemData);
        break;
      case "cmd_show":
        showDownload(selItemData);
        break;
      case "cmd_openReferrer":
        if (selItemData.referrer)
          openUILink(selItemData.referrer);
        // Otherwise, open the source
        else
          openUILink(selItemData.uri);
        break;
      case "cmd_copyLocation":
        let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
        let uris = [];
        for (let idx = 0; idx < m_selIdx.length; idx++) {
          let dldata = gDownloadTreeView.getRowData(idx);
          uris.push(dldata.uri);
        }
        clipboard.copyString(uris.join("\n"));
        break;
      case "cmd_selectAll":
        gDownloadTreeView.selection.selectAll();
        break;
      case "cmd_clearList":
        // Clear the whole list if there's no search
        if (gSearchBox.value == "") {
          gDownloadManager.cleanUp();
          gDownloadTreeView.initTree();
          return;
        }

        // Remove each download starting from the end until we hit a download
        // that is in progress
        for (let idx = m_selIdx.length - 1; idx >= 0; idx--) {
          let dldata = gDownloadTreeView.getRowData(idx);
          if (!dldata.isActive) {
            gDownloadManager.removeDownload(dldata.dlid);
            gDownloadTreeView.removeTreeRow(idx);
          }
        }

        // Clear the input as if the user did it and move focus to the list
        gSearchBox.value = "";
        gSearchBox.doCommand();
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
    let cmds = ["cmd_pause", "cmd_resume", "cmd_retry", "cmd_cancel",
                "cmd_remove", "cmd_open", "cmd_show", "cmd_openReferrer",
                "cmd_copyLocation", "cmd_selectAll", "cmd_clearList"];
    for (let command in cmds)
      goUpdateCommand(cmds[command]);
  }
};
