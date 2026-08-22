/* ============================================
   Straw Hut Media — Admin Portal
   (Backend-powered: Google Sheets via Apps Script)
   ============================================ */

(function () {
  "use strict";

  var ENDPOINT = (typeof SHM_UPLOAD_ENDPOINT !== "undefined") ? SHM_UPLOAD_ENDPOINT : "";
  var CREDENTIALS = {
    username: "strawhutmedia",
    passwordHash: "a]T9#kP2x!mW"
  };

  // In-memory cache
  var cachedSubmissions = [];
  var cachedCompanies = [];

  // ---- DOM refs ----
  var loginScreen = document.getElementById("admin-login");
  var dashboard = document.getElementById("admin-dashboard");
  var usernameInput = document.getElementById("admin-username");
  var passwordInput = document.getElementById("admin-password");
  var loginBtn = document.getElementById("login-btn");
  var loginError = document.getElementById("login-error");
  var logoutBtn = document.getElementById("logout-btn");
  var newCompanyInput = document.getElementById("new-company");
  var addBtn = document.getElementById("add-company-btn");
  var addError = document.getElementById("add-error");
  var companyList = document.getElementById("company-list");
  var companyCount = document.getElementById("company-count");
  var emptyState = document.getElementById("empty-state");
  var submissionsList = document.getElementById("submissions-list");
  var submissionCount = document.getElementById("submission-count");
  var submissionsEmpty = document.getElementById("submissions-empty");

  // ---- Helpers ----
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function switchScreen(target) {
    [loginScreen, dashboard].forEach(function (s) {
      s.classList.remove("active");
    });
    target.classList.add("active");
  }

  // ---- Tabs ----
  var tabs = document.querySelectorAll(".admin-tab");
  var tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var target = tab.dataset.tab;
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tabContents.forEach(function (tc) { tc.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById("tab-" + target).classList.add("active");
    });
  });

  // ============================================================
  //  Backend API helpers
  // ============================================================

  function apiGet(action) {
    return fetch(ENDPOINT + "?action=" + action)
      .then(function (res) { return res.json(); });
  }

  function apiPost(payload) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); });
  }

  // ============================================================
  //  Load data from backend
  // ============================================================

  function loadSubmissions(callback) {
    submissionsList.innerHTML = '<p class="loading-msg">Loading submissions...</p>';
    apiGet("getSubmissions")
      .then(function (json) {
        if (json.success) {
          cachedSubmissions = json.submissions || [];
        }
        renderSubmissions();
        if (callback) callback();
      })
      .catch(function (err) {
        submissionsList.innerHTML = '<p class="error-msg">Could not load submissions. Check your internet connection.<br><small>' + escapeHtml(err.message) + '</small></p>';
      });
  }

  function loadCompanies(callback) {
    apiGet("getCompanies")
      .then(function (json) {
        if (json.success) {
          cachedCompanies = json.companies || [];
        }
        renderCompanies();
        if (callback) callback();
      })
      .catch(function (err) {
        companyList.innerHTML = '<p class="error-msg">Could not load companies. Check your internet connection.</p>';
      });
  }

  // ---- Auth ----
  function checkCredentials(username, password) {
    return username === CREDENTIALS.username && password === "$4ForLife";
  }

  loginBtn.addEventListener("click", function () {
    var user = usernameInput.value.trim();
    var pass = passwordInput.value;

    if (!user || !pass) {
      show(loginError);
      return;
    }

    if (checkCredentials(user, pass)) {
      hide(loginError);
      sessionStorage.setItem("shm_admin_auth", "1");
      switchScreen(dashboard);
      loadSubmissions();
      loadCompanies();
    } else {
      show(loginError);
    }
  });

  passwordInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); loginBtn.click(); }
  });
  usernameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); loginBtn.click(); }
  });

  usernameInput.addEventListener("input", function () { hide(loginError); });
  passwordInput.addEventListener("input", function () { hide(loginError); });

  logoutBtn.addEventListener("click", function () {
    sessionStorage.removeItem("shm_admin_auth");
    usernameInput.value = "";
    passwordInput.value = "";
    switchScreen(loginScreen);
  });

  if (sessionStorage.getItem("shm_admin_auth") === "1") {
    switchScreen(dashboard);
    loadSubmissions();
    loadCompanies();
  }

  // ============================================================
  //  Company CRUD (via backend)
  // ============================================================

  function renderCompanies() {
    companyCount.textContent = cachedCompanies.length;
    companyList.innerHTML = "";

    if (cachedCompanies.length === 0) {
      show(emptyState);
      return;
    }

    hide(emptyState);

    cachedCompanies.forEach(function (name, idx) {
      var div = document.createElement("div");
      div.className = "company-item";
      div.innerHTML =
        '<span class="company-name">' + escapeHtml(name) + '</span>' +
        '<button class="company-remove" data-name="' + escapeHtml(name) + '" title="Remove">&times;</button>';
      companyList.appendChild(div);
    });

    companyList.querySelectorAll(".company-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.dataset.name;
        btn.disabled = true;
        btn.textContent = "...";
        apiPost({ action: "removeCompany", name: name })
          .then(function (json) {
            if (json.success) {
              cachedCompanies = json.companies || [];
              renderCompanies();
            }
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = "\u00d7";
          });
      });
    });
  }

  addBtn.addEventListener("click", function () {
    addCompany();
  });

  newCompanyInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addCompany(); }
  });

  newCompanyInput.addEventListener("input", function () {
    hide(addError);
    newCompanyInput.classList.remove("input-error");
  });

  function addCompany() {
    var name = newCompanyInput.value.trim();
    if (!name) {
      newCompanyInput.classList.add("input-error");
      return;
    }

    var duplicate = cachedCompanies.some(function (c) {
      return c.toLowerCase() === name.toLowerCase();
    });

    if (duplicate) {
      addError.textContent = "\"" + name + "\" is already in the list.";
      show(addError);
      return;
    }

    addBtn.disabled = true;
    addBtn.textContent = "Adding...";

    apiPost({ action: "addCompany", name: name })
      .then(function (json) {
        if (json.success) {
          cachedCompanies = json.companies || [];
          newCompanyInput.value = "";
          newCompanyInput.classList.remove("input-error");
          hide(addError);
          renderCompanies();
        } else {
          addError.textContent = "Could not add company.";
          show(addError);
        }
      })
      .catch(function (err) {
        addError.textContent = "Network error. Try again.";
        show(addError);
      })
      .finally(function () {
        addBtn.disabled = false;
        addBtn.textContent = "Add";
      });
  }

  // ============================================================
  //  Submissions rendering (from backend data)
  // ============================================================

  function renderSubmissions() {
    submissionCount.textContent = cachedSubmissions.length;
    submissionsList.innerHTML = "";

    if (cachedSubmissions.length === 0) {
      show(submissionsEmpty);
      return;
    }

    hide(submissionsEmpty);

    // Sort by date descending (newest first)
    cachedSubmissions.sort(function (a, b) {
      return new Date(b.submittedAt) - new Date(a.submittedAt);
    });

    cachedSubmissions.forEach(function (sub, idx) {
      var card = document.createElement("div");
      card.className = "submission-card";

      var completeness = calcCompleteness(sub);
      var date = sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      }) : "Unknown date";

      var statusClass = completeness >= 80 ? "status-good" : completeness >= 50 ? "status-partial" : "status-low";

      card.innerHTML =
        '<div class="submission-header" data-idx="' + idx + '">' +
          '<div class="submission-info">' +
            '<strong class="submission-company">' + escapeHtml(sub.company || "Unknown Company") + '</strong>' +
            '<span class="submission-meta">' + escapeHtml((sub.contactFirstName || "") + " " + (sub.contactLastName || "")) + ' &middot; ' + escapeHtml(date) + '</span>' +
          '</div>' +
          '<div class="submission-right">' +
            '<span class="submission-completeness ' + statusClass + '">' + completeness + '% complete</span>' +
            '<span class="submission-toggle">&#9660;</span>' +
          '</div>' +
        '</div>' +
        '<div class="submission-details hidden" id="sub-details-' + idx + '">' +
          buildSubmissionDetails(sub, idx) +
          '<div class="submission-actions">' +
            '<button class="btn primary btn-sm save-sub" data-idx="' + idx + '">Save Changes</button>' +
            '<button class="btn secondary btn-sm resend-sub" data-idx="' + idx + '">Resend Email</button>' +
            '<button class="btn secondary btn-sm delete-sub" data-idx="' + idx + '">Delete</button>' +
          '</div>' +
          '<div class="submission-status hidden" id="sub-status-' + idx + '"></div>' +
        '</div>';

      submissionsList.appendChild(card);
    });

    // Toggle expand/collapse
    submissionsList.querySelectorAll(".submission-header").forEach(function (header) {
      header.addEventListener("click", function () {
        var idx = header.dataset.idx;
        var details = document.getElementById("sub-details-" + idx);
        var toggle = header.querySelector(".submission-toggle");
        if (details.classList.contains("hidden")) {
          details.classList.remove("hidden");
          toggle.innerHTML = "&#9650;";
        } else {
          details.classList.add("hidden");
          toggle.innerHTML = "&#9660;";
        }
      });
    });

    // Save buttons
    submissionsList.querySelectorAll(".save-sub").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        saveSubmissionEdits(idx);
      });
    });

    // Resend email buttons
    submissionsList.querySelectorAll(".resend-sub").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        saveSubmissionEdits(idx, function () {
          resendEmail(idx);
        });
      });
    });

    // Delete buttons
    submissionsList.querySelectorAll(".delete-sub").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        var sub = cachedSubmissions[idx];
        if (!sub || !sub._id) return;

        btn.disabled = true;
        btn.textContent = "Deleting...";
        showStatus(idx, "Deleting...", "info");

        apiPost({ action: "deleteSubmission", id: sub._id })
          .then(function (json) {
            if (json.success) {
              cachedSubmissions.splice(idx, 1);
              renderSubmissions();
            } else {
              showStatus(idx, "Delete failed.", "error");
              btn.disabled = false;
              btn.textContent = "Delete";
            }
          })
          .catch(function () {
            showStatus(idx, "Network error. Try again.", "error");
            btn.disabled = false;
            btn.textContent = "Delete";
          });
      });
    });
  }

  // ---- Save edits to backend ----
  function saveSubmissionEdits(idx, callback) {
    var sub = cachedSubmissions[idx];
    if (!sub || !sub._id) return;

    var container = document.getElementById("sub-details-" + idx);
    var inputs = container.querySelectorAll("[data-field]");
    var updates = {};
    inputs.forEach(function (input) {
      var key = input.dataset.field;
      updates[key] = input.value;
      sub[key] = input.value; // Update local cache too
    });

    showStatus(idx, "Saving...", "info");

    apiPost({ action: "updateSubmission", id: sub._id, data: updates })
      .then(function (json) {
        if (json.success) {
          showStatus(idx, "Changes saved.", "success");
          if (callback) callback();
        } else {
          showStatus(idx, "Save failed: " + (json.error || "Unknown error"), "error");
        }
      })
      .catch(function (err) {
        showStatus(idx, "Network error: " + err.message, "error");
      });
  }

  // ---- Resend email notification ----
  function resendEmail(idx) {
    var data = cachedSubmissions[idx];

    var notifyEl = document.getElementById("notify-email");
    var email = notifyEl ? notifyEl.textContent : "onboarding@strawhutmedia.com";
    var endpoint = "https://formsubmit.co/ajax/" + email;

    var body = "PODCAST ONBOARDING SUBMISSION (Resent from Admin)\n";
    body += "Company: " + (data.company || "Unknown") + "\n";
    body += "Originally Submitted: " + (data.submittedAt ? new Date(data.submittedAt).toLocaleString() : "Unknown") + "\n\n";

    body += "--- CONTACT INFORMATION ---\n";
    body += "Name: " + (data.contactFirstName || "") + " " + (data.contactLastName || "") + "\n";
    body += "Email: " + (data.contactEmail || "Not provided") + "\n";
    body += "Phone: " + (data.contactPhone || "Not provided") + "\n";
    body += "Role: " + (data.contactRole || "Not provided") + "\n";
    body += "Timezone: " + (data.contactTimezone || "Not provided") + "\n";
    body += "Preferred Contact: " + (data.preferredContact || "Not provided") + "\n\n";

    body += "--- PODCAST BASICS ---\n";
    body += "Podcast Name: " + (data.podcastName || "Not provided") + "\n";
    body += "Description: " + (data.podcastDescription || "Not provided") + "\n";
    body += "Status: " + (data.podcastStatus || "Not provided") + "\n";
    body += "Brand Status: " + (data.brandStatus || "Not provided") + "\n";
    if (data.existingPodcastUrl) body += "Existing Podcast URL: " + data.existingPodcastUrl + "\n";
    if (data.existingPodcastNotes) body += "Existing Podcast Notes: " + data.existingPodcastNotes + "\n";
    body += "Genre: " + (data.podcastGenre || "Not provided") + "\n";
    body += "Format: " + (data.podcastFormat || "Not provided") + "\n";
    body += "Target Audience: " + (data.targetAudience || "Not provided") + "\n\n";

    body += "--- BRANDING ---\n";
    body += "Has Guidelines: " + (data.hasBrandGuidelines || "Not provided") + "\n";
    body += "Brand Colors: " + (data.brandColors || "Not provided") + "\n";
    body += "Fonts: " + (data.brandFonts || "Not provided") + "\n";
    body += "Voice/Tone: " + (data.brandVoice || "Not provided") + "\n\n";

    body += "--- UPLOADED FILES ---\n";
    ["brandFilesData", "logoFilesData", "inspoFilesData", "musicFilesData"].forEach(function (key) {
      if (data[key] && data[key].length > 0) {
        var label = key.replace("FilesData", "").replace(/([A-Z])/g, " $1").trim();
        body += label.charAt(0).toUpperCase() + label.slice(1) + ":\n";
        data[key].forEach(function (f) {
          body += "  - " + f.name;
          if (f.viewUrl) body += " (" + f.viewUrl + ")";
          body += "\n";
        });
      }
    });
    body += "\n";

    body += "--- INSPIRATION ---\n";
    body += "Podcasts Admired: " + (data.inspoPodcasts || "Not provided") + "\n";
    body += "Brands Admired: " + (data.inspoBrands || "Not provided") + "\n";
    body += "Visual Notes: " + (data.inspoNotes || "Not provided") + "\n\n";

    body += "--- MUSIC & AUDIO ---\n";
    body += "Needs Music: " + (data.needsMusic || "Not provided") + "\n";
    body += "Music Vibe: " + (data.musicVibe || "Not provided") + "\n";
    body += "Music References: " + (data.musicReferences || "Not provided") + "\n";
    body += "Sound Effects: " + (data.wantsSFX || "Not provided") + "\n\n";

    body += "--- SOCIAL MEDIA & WEB ---\n";
    body += "Website: " + (data.socialWebsite || "Not provided") + "\n";
    body += "Instagram: " + (data.socialInstagram || "Not provided") + "\n";
    body += "X (Twitter): " + (data.socialTwitter || "Not provided") + "\n";
    body += "TikTok: " + (data.socialTiktok || "Not provided") + "\n";
    body += "YouTube: " + (data.socialYoutube || "Not provided") + "\n";
    body += "LinkedIn: " + (data.socialLinkedin || "Not provided") + "\n";
    body += "Social Management: " + (data.manageSocial || "Not provided") + "\n";
    body += "Short-form Clips: " + (data.wantsClips || "Not provided") + "\n\n";

    body += "--- RECORDING & LOGISTICS ---\n";
    body += "Location: " + (data.recordingLocation || "Not provided") + "\n";
    if (data.locationAddress) body += "Address: " + data.locationAddress + "\n";
    body += "Frequency: " + (data.episodeFrequency || "Not provided") + "\n";
    body += "Episode Length: " + (data.episodeLength || "Not provided") + "\n";
    body += "Host(s): " + (data.hostsInfo || "Not provided") + "\n";
    body += "Guests: " + (data.hasGuests || "Not provided") + "\n";
    body += "Video: " + (data.isVideo || "Not provided") + "\n";
    body += "Launch Date: " + (data.launchDate || "Not provided") + "\n";
    body += "Logistics Notes: " + (data.logisticsNotes || "Not provided") + "\n\n";

    body += "--- MARKETING & LAUNCH ---\n";
    body += "Launch Episodes: " + (data.launchEpisodes || "Not provided") + "\n";
    body += "Teaser Ideas: " + (data.teaserIdeas || "Not provided") + "\n";
    body += "Marketing Notes: " + (data.marketingNotes || "Not provided") + "\n";
    body += "Goals: " + (data.goals || "Not provided") + "\n\n";

    body += "--- ADDITIONAL ---\n";
    body += "Anything Else: " + (data.anythingElse || "Not provided") + "\n";

    var formData = new FormData();
    formData.append("_subject", "Onboarding (Resent): " + (data.company || "Unknown Company") + " — " + (data.podcastName || "Unnamed Podcast"));
    formData.append("Company", data.company || "");
    formData.append("Contact", (data.contactFirstName || "") + " " + (data.contactLastName || ""));
    formData.append("Email", data.contactEmail || "");
    formData.append("Phone", data.contactPhone || "");
    formData.append("Podcast Name", data.podcastName || "");
    formData.append("message", body);
    formData.append("_template", "box");

    showStatus(idx, "Sending email...", "info");

    fetch(endpoint, {
      method: "POST",
      body: formData,
      headers: { "Accept": "application/json" }
    }).then(function (res) {
      if (res.ok) {
        showStatus(idx, "Email sent successfully.", "success");
      } else {
        showStatus(idx, "Email failed (status " + res.status + "). Check the email address.", "error");
      }
    }).catch(function (err) {
      showStatus(idx, "Email error: " + err.message, "error");
    });
  }

  function showStatus(idx, message, type) {
    var el = document.getElementById("sub-status-" + idx);
    if (!el) return;
    el.textContent = message;
    el.className = "submission-status status-msg-" + type;
    el.classList.remove("hidden");
    if (type === "success") {
      setTimeout(function () { el.classList.add("hidden"); }, 3000);
    }
  }

  function calcCompleteness(sub) {
    var fields = [
      sub.contactFirstName, sub.contactLastName, sub.contactEmail,
      sub.contactPhone, sub.contactRole, sub.contactTimezone, sub.preferredContact,
      sub.podcastName, sub.podcastDescription, sub.podcastStatus, sub.brandStatus,
      sub.podcastGenre, sub.podcastFormat, sub.targetAudience,
      sub.hasBrandGuidelines, sub.brandColors, sub.brandFonts, sub.brandVoice,
      sub.inspoPodcasts, sub.inspoBrands,
      sub.needsMusic, sub.musicVibe,
      sub.socialWebsite, sub.socialInstagram,
      sub.recordingLocation, sub.episodeFrequency, sub.episodeLength, sub.hostsInfo,
      sub.hasGuests, sub.isVideo,
      sub.launchEpisodes, sub.teaserIdeas,
      sub.goals
    ];
    var filled = 0;
    fields.forEach(function (f) {
      if (f && f.toString().trim()) filled++;
    });
    return Math.round((filled / fields.length) * 100);
  }

  function buildSubmissionDetails(sub, idx) {
    var html = '<div class="sub-detail-grid">';

    // Contact Information (including additional contacts)
    var contactFields = [
      ["First Name", "contactFirstName", sub.contactFirstName],
      ["Last Name", "contactLastName", sub.contactLastName],
      ["Email", "contactEmail", sub.contactEmail],
      ["Phone", "contactPhone", sub.contactPhone],
      ["Role", "contactRole", sub.contactRole],
      ["Primary Contact", "primaryContact", sub.primaryContact === "0" || !sub.primaryContact ? "Main contact" : "Additional #" + sub.primaryContact],
      ["Timezone", "contactTimezone", sub.contactTimezone],
      ["Preferred Contact", "preferredContact", sub.preferredContact]
    ];

    // Add additional contacts if present
    for (var ci = 1; ci <= 3; ci++) {
      var fn = sub["altContact" + ci + "FirstName"];
      var ln = sub["altContact" + ci + "LastName"];
      if (fn || ln) {
        contactFields.push(["Alt Contact " + ci + " Name", "altContact" + ci + "FirstName", (fn || "") + " " + (ln || "")]);
        contactFields.push(["Alt Contact " + ci + " Email", "altContact" + ci + "Email", sub["altContact" + ci + "Email"]]);
        contactFields.push(["Alt Contact " + ci + " Role", "altContact" + ci + "Role", sub["altContact" + ci + "Role"]]);
      }
    }

    html += sectionBlock("Contact Information", contactFields);

    html += sectionBlock("Podcast Basics", [
      ["Podcast Name", "podcastName", sub.podcastName],
      ["Description", "podcastDescription", sub.podcastDescription, true],
      ["Status", "podcastStatus", sub.podcastStatus],
      ["Brand Status", "brandStatus", sub.brandStatus],
      ["Existing Podcast URL", "existingPodcastUrl", sub.existingPodcastUrl],
      ["Existing Podcast Notes", "existingPodcastNotes", sub.existingPodcastNotes, true],
      ["Genre", "podcastGenre", sub.podcastGenre],
      ["Format", "podcastFormat", sub.podcastFormat],
      ["Target Audience", "targetAudience", sub.targetAudience, true]
    ]);

    html += sectionBlock("Branding", [
      ["Has Guidelines", "hasBrandGuidelines", sub.hasBrandGuidelines],
      ["Brand Colors", "brandColors", sub.brandColors],
      ["Fonts", "brandFonts", sub.brandFonts],
      ["Voice / Tone", "brandVoice", sub.brandVoice, true]
    ]);

    // Brand guidelines files
    html += filesBlock("Brand & Logo Uploads", sub.brandFilesData, sub.logoFilesData);

    html += sectionBlock("Inspiration", [
      ["Podcasts Admired", "inspoPodcasts", sub.inspoPodcasts, true],
      ["Brands Admired", "inspoBrands", sub.inspoBrands, true],
      ["Visual Notes", "inspoNotes", sub.inspoNotes, true]
    ]);

    // Inspiration files
    html += filesBlock("Inspiration Uploads", sub.inspoFilesData);

    html += sectionBlock("Music & Audio", [
      ["Needs Music", "needsMusic", sub.needsMusic],
      ["Music Vibe", "musicVibe", sub.musicVibe, true],
      ["Music References", "musicReferences", sub.musicReferences, true],
      ["Sound Effects", "wantsSFX", sub.wantsSFX]
    ]);

    // Music files
    html += filesBlock("Music Uploads", sub.musicFilesData);

    html += sectionBlock("Social Media & Web", [
      ["Website", "socialWebsite", sub.socialWebsite],
      ["Instagram", "socialInstagram", sub.socialInstagram],
      ["X (Twitter)", "socialTwitter", sub.socialTwitter],
      ["TikTok", "socialTiktok", sub.socialTiktok],
      ["YouTube", "socialYoutube", sub.socialYoutube],
      ["LinkedIn", "socialLinkedin", sub.socialLinkedin],
      ["Social Management", "manageSocial", sub.manageSocial],
      ["Short-form Clips", "wantsClips", sub.wantsClips]
    ]);

    var logisticsFields = [
      ["Location", "recordingLocation", sub.recordingLocation],
      ["Address", "locationAddress", sub.locationAddress],
      ["Frequency", "episodeFrequency", sub.episodeFrequency],
      ["Episode Length", "episodeLength", sub.episodeLength],
      ["Host(s)", "hostsInfo", sub.hostsInfo, true],
      ["Guests", "hasGuests", sub.hasGuests],
      ["Guest Booking", "guestBooking", sub.guestBooking],
      ["Video", "isVideo", sub.isVideo],
      ["Video References", "videoReferences", sub.videoReferences, true],
      ["Launch Date", "launchDate", sub.launchDate],
      ["Logistics Notes", "logisticsNotes", sub.logisticsNotes, true]
    ];

    html += sectionBlock("Recording & Logistics", logisticsFields);

    html += sectionBlock("Marketing & Launch", [
      ["Launch Episodes", "launchEpisodes", sub.launchEpisodes],
      ["Teaser Ideas", "teaserIdeas", sub.teaserIdeas, true],
      ["Marketing Notes", "marketingNotes", sub.marketingNotes, true],
      ["Goals", "goals", sub.goals, true]
    ]);

    html += sectionBlock("Additional Notes", [
      ["Notes", "anythingElse", sub.anythingElse, true]
    ]);

    html += '</div>';
    return html;
  }

  // ---- File preview blocks ----
  function filesBlock(title) {
    // Collect all file arrays passed as arguments (after title)
    var allFiles = [];
    for (var i = 1; i < arguments.length; i++) {
      var arr = arguments[i];
      if (arr && Array.isArray(arr)) {
        allFiles = allFiles.concat(arr);
      }
    }
    if (allFiles.length === 0) return '';

    var html = '<div class="sub-section">';
    html += '<h4 class="sub-section-title">' + escapeHtml(title) + '</h4>';
    html += '<div class="file-preview-grid">';

    allFiles.forEach(function (file) {
      var isImage = file.type && file.type.indexOf("image/") === 0;
      var isPdf = file.type && file.type === "application/pdf";
      var hasDrive = file.viewUrl;

      if (hasDrive) {
        // ---- Google Drive link (works from any device) ----
        var thumbSrc = isImage && file.thumbUrl ? file.thumbUrl : null;

        html += '<div class="file-preview-item">';
        html += '<a href="' + file.viewUrl + '" target="_blank" rel="noopener" class="file-drive-link">';
        if (thumbSrc) {
          html += '<img class="file-preview-thumb" src="' + thumbSrc + '" alt="' + escapeHtml(file.name) + '">';
        } else {
          html += '<span class="file-doc-icon">' + (isPdf ? '&#128196;' : '&#128190;') + '</span>';
        }
        html += '</a>';
        html += '<span class="file-preview-name">' + escapeHtml(file.name) + '</span>';
        html += '<a href="' + file.viewUrl + '" target="_blank" rel="noopener" class="file-drive-badge">View in Drive</a>';
        html += '</div>';

      } else {
        // ---- Name only (Drive link not available) ----
        html += '<div class="file-preview-item file-preview-doc">';
        html += '<span class="file-doc-icon">' + (isPdf ? '&#128196;' : '&#128190;') + '</span>';
        html += '<span class="file-preview-name">' + escapeHtml(file.name) + '</span>';
        html += '</div>';
      }
    });

    html += '</div></div>';
    return html;
  }

  function sectionBlock(title, fields) {
    var html = '<div class="sub-section">';
    html += '<h4 class="sub-section-title">' + escapeHtml(title) + '</h4>';
    html += '<div class="sub-fields-edit">';
    fields.forEach(function (field) {
      var label = field[0];
      var key = field[1];
      var value = field[2];
      var isTextarea = field[3] || false;
      var safeValue = value ? escapeHtml(value.toString()) : '';
      html += '<div class="sub-field-row">';
      html += '<label class="sub-field-label">' + escapeHtml(label) + '</label>';
      if (isTextarea) {
        html += '<textarea class="sub-field-input" data-field="' + key + '" rows="2">' + safeValue + '</textarea>';
      } else {
        html += '<input type="text" class="sub-field-input" data-field="' + key + '" value="' + safeValue + '">';
      }
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ---- Utils ----
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

})();
