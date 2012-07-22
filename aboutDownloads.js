/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function AboutDownloads() { }
AboutDownloads.prototype = {
  classID: Components.ID("{5f9b6b0d-d2d5-4381-afc4-27625c3e1668}"),
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIAboutModule]),

  getURIFlags: function(aURI) {
    return Components.interfaces.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel: function(aURI) {
    let channel = Services.io.newChannel("chrome://dlman/content/downloads.xul",
                                         null, null);
    channel.originalURI = aURI;
    return channel;
  }
};

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2.
 */
var NSGetFactory = XPCOMUtils.generateNSGetFactory([AboutDownloads]);
