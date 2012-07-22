/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function test_visibility_open()
{
  var dmui = Components.classes["@mozilla.org/download-manager-ui;1"]
                       .getService(Components.interfaces.nsIDownloadManagerUI);
  is(dmui.visible, true,
     "nsIDownloadManagerUI indicates that the UI is visible");
}

function test_visibility_closed(aWin)
{
  var dmui = Components.classes["@mozilla.org/download-manager-ui;1"]
                       .getService(Components.interfaces.nsIDownloadManagerUI);

  function dmWindowClosedListener() {
    aWin.removeEventListener("unload", dmWindowClosedListener, false);
    is(dmui.visible, false,
       "nsIDownloadManagerUI indicates that the UI is not visible");
    finish();
  }
  aWin.addEventListener("unload", dmWindowClosedListener, false);
  aWin.close();
}

var testFuncs = [
    test_visibility_open
  , test_visibility_closed /* all tests after this *must* expect there to be
                              no open window, otherwise they will fail! */
];

function test()
{
  var dm = Components.classes["@mozilla.org/download-manager;1"]
                     .getService(Components.interfaces.nsIDownloadManager);
  var db = dm.DBConnection;

  // First, we populate the database with some fake data
  db.executeSimpleSQL("DELETE FROM moz_downloads");

  var dmui = Components.classes["@mozilla.org/download-manager-ui;1"]
                       .getService(Components.interfaces.nsIKDownloadManagerUI);

  // See if the DM is already open, and if it is, close it!
  var win = dmui.recentWindow;
  if (win)
    win.close();

  gBrowser.addTab();

  // OK, now that all the data is in, let's pull up the UI
  Components.classes["@mozilla.org/download-manager-ui;1"]
            .getService(Components.interfaces.nsIKDownloadManagerUI).showManager();

  let obs = Components.classes["@mozilla.org/observer-service;1"]
                      .getService(Components.interfaces.nsIObserverService);
  const DLMGR_UI_DONE = "download-manager-ui-done";

  let testObs = {
    observe: function(aSubject, aTopic, aData) {
      obs.removeObserver(testObs, DLMGR_UI_DONE);
      var win = dmui.recentWindow;

      // Now we can run our tests
      for each (var t in testFuncs)
        t(win);

      // finish will be called by the last test that also hides the DM UI
    }
  };

  waitForExplicitFinish();
  obs.addObserver(testObs, DLMGR_UI_DONE, false);
}
