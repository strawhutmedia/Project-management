/**
 * Straw Hut Media — Onboarding Configuration
 */

/* Notification email — submissions are sent here via FormSubmit.co */
var SHM_NOTIFICATION_EMAIL = "onboarding@strawhutmedia.com";

/*
 * Google Apps Script Web App URL — single endpoint for everything:
 * file uploads, submission storage, and company management.
 * See google-apps-script.gs for setup instructions.
 * After deploying, paste your Web App URL below.
 */
var SHM_UPLOAD_ENDPOINT = "https://script.google.com/macros/s/AKfycbx1UWNpB__k-daVkmbrzexhnLW633vNPeav_aPNSVZQugSJB5DXoQY3nhVHCgvG2e3yDg/exec";

/*
 * Approved Companies — loaded from the backend (Google Sheets).
 * The form starts with a fallback list, then fetches the real list from the backend.
 * When the backend responds, the dropdown is dynamically updated.
 */
var APPROVED_COMPANIES = [];

(function loadCompaniesFromBackend() {
  var endpoint = (typeof SHM_UPLOAD_ENDPOINT !== "undefined") ? SHM_UPLOAD_ENDPOINT : "";
  if (!endpoint) return;

  fetch(endpoint + "?action=getCompanies")
    .then(function (res) { return res.json(); })
    .then(function (json) {
      if (json.success && json.companies) {
        APPROVED_COMPANIES = json.companies;
      }
    })
    .catch(function (err) {
      console.warn("Could not load companies from backend:", err);
    });
})();
