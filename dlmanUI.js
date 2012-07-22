/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

////////////////////////////////////////////////////////////////////////////////
//// Constants

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const TOOLKIT_MANAGER_URL = "chrome://mozapps/content/downloads/downloads.xul";
const DOWNLOAD_MANAGER_URL = "about:downloads";
const PREF_FLASH_COUNT = "browser.download.manager.flashCount";
const PREF_DM_BEHAVIOR = "browser.download.manager.behavior";
const PREF_FORCE_TOOLKIT_UI = "browser.download.manager.useToolkitUI";

////////////////////////////////////////////////////////////////////////////////
//// nsDownloadManagerUI class

function nsDownloadManagerUI() {}

nsDownloadManagerUI.prototype = {
  classID: Components.ID("{ac31593d-06f1-4b1e-be31-a8a70d9dc5ca}"),

  //////////////////////////////////////////////////////////////////////////////
  //// nsIDownloadManagerUI

  show: function show(aWindowContext, aID, aReason)
  {
    var behavior = 0;
    if (aReason != Ci.nsIDownloadManagerUI.REASON_USER_INTERACTED) {
      try {
        behavior = Services.prefs.getIntPref(PREF_DM_BEHAVIOR);
        if (Services.prefs.getBoolPref(PREF_FORCE_TOOLKIT_UI))
          behavior = 0; //We are forcing toolkit UI, force manager behavior
      } catch (e) { }
    }

    switch (behavior) {
      case 0:
        this.showManager(aWindowContext, aID, aReason);
        break;
      case 1:
        this.showProgress(aWindowContext, aID, aReason);
    }

    return; // No UI for behavior >= 2
  },

  get visible() {
    return this.recentWindow != null;
  },

  getAttention: function getAttention()
  {
    if (!this.visible)
      throw Cr.NS_ERROR_UNEXPECTED;

    // This preference may not be set, so defaulting to two.
    var flashCount = 2;
    try {
      flashCount = Services.prefs.getIntPref(PREF_FLASH_COUNT);
    } catch (e) { }

    this.recentWindow.getAttentionWithCycleCount(flashCount);
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIKDownloadManagerUI / nsDownloadManagerUI

  get recentWindow() {
    let winEnum = Services.wm.getEnumerator("navigator:browser");
    while (winEnum.hasMoreElements()) {
      let browserWin = winEnum.getNext();
      // Skip closed (but not yet destroyed) windows,
      // and any window without a browser object.
      if (browserWin.closed || !browserWin.gBrowser)
        continue;
      let browsers = browserWin.gBrowser.browsers;
      for (let i = 0; i < browsers.length; i++) {
        let browser = browsers[i];
        if (browser.currentURI.spec == DOWNLOAD_MANAGER_URL) {
          return browser.contentWindow;
        }
      }
    }
    return null;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIKDownloadManagerUI

  showManager: function showManager(aWindowContext, aID, aReason)
  {
    // First we see if it is already visible
    let window = this.recentWindow;
    if (window) {
      window.focus();

      // If we are being asked to show again, with a user interaction reason,
      // set the appropriate variable.
      if (aReason == Ci.nsIDownloadManagerUI.REASON_USER_INTERACTED)
        window.gUserInteracted = true;
      return;
    }

    let parent = null;
    // We try to get a window to use as the parent here.  If we don't have one,
    // the download manager will close immediately after opening if the pref
    // browser.download.manager.closeWhenDone is set to true.
    try {
      if (aWindowContext)
        parent = aWindowContext.getInterface(Ci.nsIDOMWindow);
    } catch (e) { /* it's OK to not have a parent window */ }

    // We pass the download manager and the nsIDownload we want selected (if any)
    let params = Cc["@mozilla.org/array;1"].
                 createInstance(Ci.nsIMutableArray);
    let pArr = []; // pure JS version of the same

    // Don't fail if our passed in ID is invalid
    let download = null;
    try {
      let dm = Cc["@mozilla.org/download-manager;1"].
               getService(Ci.nsIDownloadManager);
      download = dm.getDownload(aID);
    } catch (ex) {}
    params.appendElement(download, false);
    pArr.push(download);

    // Pass in the reason as well
    let reason = Cc["@mozilla.org/supports-PRInt16;1"].
                 createInstance(Ci.nsISupportsPRInt16);
    reason.data = aReason;
    params.appendElement(reason, false);
    pArr.push(reason);

    try {
      if (Services.prefs.getBoolPref(PREF_FORCE_TOOLKIT_UI)) {
        Services.ww.openWindow(parent,
                               TOOLKIT_MANAGER_URL,
                               null,
                               "all,dialog=no",
                               params);
        return;
      }
    } catch(ex) {}

    let win = Services.wm.getMostRecentWindow("navigator:browser");
    if (!win)
      win = Services.ww.openWindow("_blank",
                                   this._getBrowserURL(),
                                   null,
                                   "chrome,all,dialog=no",
                                   null);

    Services.obs.addObserver(function setArguments(aSubject, aTopic, aData) {
      aSubject.arguments = pArr;
      Services.obs.removeObserver(setArguments, "dlman-exists");
    }, "dlman-exists", false);
    Services.obs.notifyObservers(null, "dlman-exist-request", "");
    win.switchToTabHavingURI(DOWNLOAD_MANAGER_URL, true);
  },

  showProgress: function showProgress(aWindowContext, aID, aReason)
  {
    var params = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);

    var parent = null;
    // We try to get a window to use as the parent here.  If we don't have one,
    // the progress window will close immediately after opening if the pref
    // browser.download.manager.closeWhenDone is set to true.
    try {
      if (aWindowContext)
        parent = aWindowContext.getInterface(Ci.nsIDOMWindow);
    } catch (e) { /* it's OK to not have a parent window */ }

    // Fail if our passed in ID is invalid
    var download = Cc["@mozilla.org/download-manager;1"].
                   getService(Ci.nsIDownloadManager).
                   getDownload(aID);
    params.appendElement(download, false);

    // Pass in the reason as well
    let reason = Cc["@mozilla.org/supports-PRInt16;1"].
                 createInstance(Ci.nsISupportsPRInt16);
    reason.data = aReason;
    params.appendElement(reason, false);

    var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].
             getService(Ci.nsIWindowWatcher);
    ww.openWindow(parent,
                  "chrome://dlman/content/progressDialog.xul",
                  null,
                  "chrome,titlebar,centerscreen,minimizable=yes,dialog=no",
                  params);
  },

  //////////////////////////////////////////////////////////////////////////////
  //// private

  _getBrowserURL: function _getBrowserURL() {
    try {
      var url = Services.prefs.getCharPref("browser.chromeURL");
      if (url)
        return url;
    } catch(e) {
    }
    return "chrome://browser/content/browser.xul";
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsISupports

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIDownloadManagerUI,
                                         Ci.nsIKDownloadManagerUI])
};

////////////////////////////////////////////////////////////////////////////////
//// Module

let components = [nsDownloadManagerUI];

var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
