/* ============================================
   Straw Hut Media — Podcast Onboarding App
   ============================================ */

(function () {
  "use strict";

  // ---- State ----
  var currentSection = 1;
  var totalSections = 9;
  var approvedCompany = "";
  var uploadedFiles = { brand: [], inspo: [], logo: [], music: [] };
  var MAX_INSPO_FILES = 10;
  var completedSections = {};

  // ---- DOM refs ----
  var gateScreen = document.getElementById("gate");
  var onboardingScreen = document.getElementById("onboarding");
  var successScreen = document.getElementById("success");
  var companyInput = document.getElementById("company-name");
  var gateError = document.getElementById("gate-error");
  var gateSubmit = document.getElementById("gate-submit");
  var displayCompany = document.getElementById("display-company");
  var displayCompanyMobile = document.getElementById("display-company-mobile");
  var form = document.getElementById("onboarding-form");
  var prevBtn = document.getElementById("prev-btn");
  var nextBtn = document.getElementById("next-btn");
  var submitBtn = document.getElementById("submit-btn");
  var progressFill = document.getElementById("form-progress");
  var progressLabel = document.getElementById("progress-label");
  var sidebarProgressFill = document.getElementById("sidebar-progress-fill");
  var sidebarProgressText = document.getElementById("sidebar-progress-text");
  var formSummary = document.getElementById("form-summary");

  // ---- Helpers ----
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function switchScreen(target) {
    [gateScreen, onboardingScreen, successScreen].forEach(function (s) {
      s.classList.remove("active");
    });
    target.classList.add("active");
    window.scrollTo(0, 0);
  }

  function isApproved(name) {
    var lower = name.trim().toLowerCase();
    return APPROVED_COMPANIES.some(function (c) {
      return c.toLowerCase() === lower;
    });
  }

  // ---- Gate ----
  gateSubmit.addEventListener("click", function () {
    var name = companyInput.value.trim();
    if (!name) {
      companyInput.classList.add("input-error");
      return;
    }
    companyInput.classList.remove("input-error");
    if (isApproved(name)) {
      approvedCompany = name;
      hide(gateError);
      displayCompany.textContent = approvedCompany;
      displayCompanyMobile.textContent = approvedCompany;
      switchScreen(onboardingScreen);
      updateProgress();
      updateSidebar();
      restoreFormDraft();
    } else {
      show(gateError);
    }
  });

  companyInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); gateSubmit.click(); }
  });
  companyInput.addEventListener("input", function () {
    hide(gateError);
    companyInput.classList.remove("input-error");
  });

  // ---- Auto-save & restore ----
  var SAVE_PREFIX = "shm_draft_";

  function getSaveKey() {
    return SAVE_PREFIX + approvedCompany.trim().toLowerCase();
  }

  function saveFormDraft() {
    if (!approvedCompany) return;
    try {
      var data = getFormData();
      data._currentSection = currentSection;
      data._completedSections = completedSections;
      localStorage.setItem(getSaveKey(), JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save draft:", e);
    }
  }

  function restoreFormDraft() {
    if (!approvedCompany) return;
    try {
      var stored = localStorage.getItem(getSaveKey());
      if (!stored) return;
      var data = JSON.parse(stored);

      // Restore text inputs, textareas, selects
      var elements = form.elements;
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!el.name || el.type === "file" || el.type === "submit" || el.type === "button") continue;
        if (el.type === "radio") {
          if (data[el.name] !== undefined && el.value === data[el.name]) {
            el.checked = true;
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (el.type === "checkbox") {
          if (el.name !== "platforms" && data[el.name] !== undefined) {
            el.checked = data[el.name];
          }
        } else {
          if (data[el.name] !== undefined) {
            el.value = data[el.name];
          }
        }
      }

      // Restore completed sections
      if (data._completedSections) {
        completedSections = data._completedSections;
      }

      // Restore current section position
      if (data._currentSection && data._currentSection > 1) {
        showSection(data._currentSection);
      }
    } catch (e) {
      console.warn("Could not restore draft:", e);
    }
  }

  function clearFormDraft() {
    if (!approvedCompany) return;
    try {
      localStorage.removeItem(getSaveKey());
    } catch (e) { /* ignore */ }
  }

  // ---- Sidebar navigation (click to jump) ----
  var sidebarItems = document.querySelectorAll(".sidebar-checklist li");
  sidebarItems.forEach(function (li) {
    li.addEventListener("click", function () {
      var sectionNum = parseInt(li.dataset.sidebar);
      if (sectionNum && sectionNum !== currentSection) {
        // Mark current section as completed if it has content
        checkSectionCompletion(currentSection);
        showSection(sectionNum);
      }
    });
  });

  // ---- Multi-step form navigation ----
  function showSection(n) {
    currentSection = n;
    document.querySelectorAll(".form-section").forEach(function (s) {
      s.classList.remove("active");
    });
    var target = document.querySelector('.form-section[data-section="' + n + '"]');
    if (target) target.classList.add("active");

    prevBtn.disabled = n === 1;
    if (n === totalSections) {
      hide(nextBtn);
      show(submitBtn);
      buildSummary();
    } else {
      show(nextBtn);
      hide(submitBtn);
    }
    updateProgress();
    updateSidebar();
    window.scrollTo(0, 0);
  }

  function updateProgress() {
    var pct = ((currentSection - 1) / (totalSections - 1)) * 100;
    progressFill.style.width = pct + "%";
    progressLabel.textContent = "Section " + currentSection + " of " + totalSections;

    // Sidebar progress based on completed sections
    var completedCount = Object.keys(completedSections).length;
    var sidebarPct = Math.round((completedCount / totalSections) * 100);
    sidebarProgressFill.style.width = sidebarPct + "%";
    sidebarProgressText.textContent = sidebarPct + "% complete";
  }

  function updateSidebar() {
    sidebarItems.forEach(function (li) {
      var num = parseInt(li.dataset.sidebar);
      li.classList.remove("active");
      if (num === currentSection) {
        li.classList.add("active");
      }
      if (completedSections[num]) {
        li.classList.add("completed");
      } else {
        li.classList.remove("completed");
      }
    });
  }

  // ---- Section completion checking ----
  // Check if a section has any meaningful content filled in
  function checkSectionCompletion(sectionNum) {
    var section = document.querySelector('.form-section[data-section="' + sectionNum + '"]');
    if (!section) return;

    var hasContent = false;

    // Check text inputs, emails, urls, dates
    var textInputs = section.querySelectorAll('input[type="text"], input[type="email"], input[type="url"], input[type="date"], textarea');
    textInputs.forEach(function (input) {
      if (input.value.trim()) hasContent = true;
    });

    // Check radio buttons
    var radioGroups = {};
    var radios = section.querySelectorAll('input[type="radio"]');
    radios.forEach(function (r) {
      if (!radioGroups[r.name]) radioGroups[r.name] = false;
      if (r.checked) radioGroups[r.name] = true;
    });
    Object.keys(radioGroups).forEach(function (name) {
      if (radioGroups[name]) hasContent = true;
    });

    // Check checkboxes (non-confirm)
    var checkboxes = section.querySelectorAll('input[type="checkbox"]:not(#confirm-submit)');
    checkboxes.forEach(function (cb) {
      if (cb.checked) hasContent = true;
    });

    // Check selects
    var selects = section.querySelectorAll("select");
    selects.forEach(function (sel) {
      if (sel.value) hasContent = true;
    });

    // Check file uploads related to this section
    if (sectionNum === 3 && (uploadedFiles.brand.length > 0 || uploadedFiles.logo.length > 0)) hasContent = true;
    if (sectionNum === 4 && uploadedFiles.inspo.length > 0) hasContent = true;
    if (sectionNum === 5 && uploadedFiles.music.length > 0) hasContent = true;

    if (hasContent) {
      completedSections[sectionNum] = true;
    }

    updateProgress();
    updateSidebar();
  }

  // Listen for any input changes to auto-check completion and auto-save
  var autoSaveTimer;
  form.addEventListener("input", function () {
    checkSectionCompletion(currentSection);
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(function () { saveFormDraft(); }, 1000);
  });
  form.addEventListener("change", function () {
    checkSectionCompletion(currentSection);
    saveFormDraft();
  });

  function validateCurrentSection() {
    var section = document.querySelector('.form-section[data-section="' + currentSection + '"]');
    var inputs = section.querySelectorAll("[required]");
    var valid = true;
    inputs.forEach(function (input) {
      if (input.type === "radio") {
        var group = section.querySelectorAll('input[name="' + input.name + '"]');
        var checked = Array.prototype.some.call(group, function (r) { return r.checked; });
        if (!checked) {
          valid = false;
          group.forEach(function (r) {
            var label = r.closest(".radio-label");
            if (label) label.style.outline = "1px solid var(--color-error)";
          });
        } else {
          group.forEach(function (r) {
            var label = r.closest(".radio-label");
            if (label) label.style.outline = "none";
          });
        }
      } else {
        if (!input.value.trim()) {
          valid = false;
          input.classList.add("input-error");
        } else {
          input.classList.remove("input-error");
        }
      }
    });
    return valid;
  }

  nextBtn.addEventListener("click", function () {
    if (!validateCurrentSection()) return;
    checkSectionCompletion(currentSection);
    saveFormDraft();
    flashSaved();
    if (currentSection < totalSections) showSection(currentSection + 1);
  });

  prevBtn.addEventListener("click", function () {
    checkSectionCompletion(currentSection);
    saveFormDraft();
    flashSaved();
    if (currentSection > 1) showSection(currentSection - 1);
  });

  // ---- Conditional visibility ----
  document.querySelectorAll('input[name="podcastStatus"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var details = document.getElementById("existing-podcast-details");
      if (r.value === "existing" && r.checked) show(details); else hide(details);
    });
  });

  document.querySelectorAll('input[name="hasBrandGuidelines"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var upload = document.getElementById("brand-guidelines-upload");
      if ((r.value === "yes" || r.value === "partial") && r.checked) show(upload); else hide(upload);
    });
  });

  document.querySelectorAll('input[name="recordingLocation"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var details = document.getElementById("client-location-details");
      if (r.value === "client-location" && r.checked) show(details); else hide(details);
    });
  });

  document.querySelectorAll('input[name="needsMusic"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var upload = document.getElementById("existing-music-upload");
      if (r.value === "have-some" && r.checked) show(upload); else hide(upload);
    });
  });

  // Guest booking conditional
  document.querySelectorAll('input[name="hasGuests"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var details = document.getElementById("guest-booking-details");
      if ((r.value === "yes" || r.value === "sometimes") && r.checked) show(details); else hide(details);
    });
  });

  // Video reference conditional
  document.querySelectorAll('input[name="isVideo"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var details = document.getElementById("video-reference-details");
      if (r.value === "yes" && r.checked) show(details); else hide(details);
    });
  });

  // ---- Submit button toggle (disabled until checkbox checked) ----
  var confirmCheckbox = document.getElementById("confirm-submit");
  confirmCheckbox.addEventListener("change", function () {
    submitBtn.disabled = !confirmCheckbox.checked;
    if (confirmCheckbox.checked) {
      confirmCheckbox.closest(".checkbox-label").style.outline = "none";
    }
  });

  // ---- Additional contacts ----
  var additionalContactsContainer = document.getElementById("additional-contacts");
  var addContactBtn = document.getElementById("add-contact-btn");
  var contactCount = 0;
  var MAX_ADDITIONAL_CONTACTS = 3;

  addContactBtn.addEventListener("click", function () {
    if (contactCount >= MAX_ADDITIONAL_CONTACTS) return;
    contactCount++;
    var idx = contactCount;

    var block = document.createElement("div");
    block.className = "contact-block";
    block.dataset.contact = idx;
    block.innerHTML =
      '<button type="button" class="remove-contact-btn" title="Remove contact">&times;</button>' +
      '<div class="contact-block-header">' +
        '<span class="contact-block-title">Additional Contact ' + idx + '</span>' +
        '<label class="radio-label primary-radio">' +
          '<input type="radio" name="primaryContact" value="' + idx + '"> Primary' +
        '</label>' +
      '</div>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label>First Name</label>' +
          '<input type="text" name="altContact' + idx + 'FirstName" placeholder="First name">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Last Name</label>' +
          '<input type="text" name="altContact' + idx + 'LastName" placeholder="Last name">' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Email Address</label>' +
        '<input type="email" name="altContact' + idx + 'Email" placeholder="email@company.com">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Role / Title</label>' +
        '<input type="text" name="altContact' + idx + 'Role" placeholder="e.g. Producer, Co-host, Marketing Lead">' +
      '</div>';

    additionalContactsContainer.appendChild(block);
    updatePrimaryRadioStyles();

    if (contactCount >= MAX_ADDITIONAL_CONTACTS) {
      addContactBtn.disabled = true;
    }

    // Remove contact handler
    block.querySelector(".remove-contact-btn").addEventListener("click", function () {
      // If removing the primary contact, reset to first contact
      var radio = block.querySelector('input[name="primaryContact"]');
      if (radio.checked) {
        var firstRadio = document.querySelector('input[name="primaryContact"][value="0"]');
        if (firstRadio) { firstRadio.checked = true; }
      }
      block.remove();
      contactCount--;
      addContactBtn.disabled = false;
      updatePrimaryRadioStyles();
      checkSectionCompletion(currentSection);
    });
  });

  // Update primary radio visual state
  function updatePrimaryRadioStyles() {
    document.querySelectorAll('.primary-radio').forEach(function (label) {
      var radio = label.querySelector('input[type="radio"]');
      if (radio && radio.checked) {
        label.classList.add("selected");
      } else {
        label.classList.remove("selected");
      }
    });
  }

  document.addEventListener("change", function (e) {
    if (e.target.name === "primaryContact") {
      updatePrimaryRadioStyles();
    }
  });

  // ---- Auto-save flash indicator ----
  var saveNotice = document.getElementById("autosave-notice");
  var saveFlashTimeout;

  function flashSaved() {
    var span = saveNotice.querySelector("span");
    span.innerHTML = '<span class="save-flash">Saved!</span>';
    clearTimeout(saveFlashTimeout);
    saveFlashTimeout = setTimeout(function () {
      span.textContent = "Your progress is automatically saved";
    }, 2000);
  }

  // ---- File uploads ----
  function setupFileUpload(inputId, listId, storageKey, maxFiles) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var list = document.getElementById(listId);
    var dropZone = input.closest(".file-upload-area");

    function renderList() {
      list.innerHTML = "";
      uploadedFiles[storageKey].forEach(function (f, i) {
        var li = document.createElement("li");
        li.innerHTML =
          '<span>' + escapeHtml(f.name) + ' <small>(' + formatSize(f.size) + ')</small></span>' +
          '<button class="remove-file" data-idx="' + i + '">&times;</button>';
        list.appendChild(li);
      });
      list.querySelectorAll(".remove-file").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          uploadedFiles[storageKey].splice(parseInt(btn.dataset.idx), 1);
          renderList();
          checkSectionCompletion(currentSection);
        });
      });
    }

    function addFiles(files) {
      var limitError = document.getElementById("inspo-limit-error");
      for (var i = 0; i < files.length; i++) {
        if (maxFiles && uploadedFiles[storageKey].length >= maxFiles) {
          if (limitError) show(limitError);
          break;
        }
        uploadedFiles[storageKey].push(files[i]);
      }
      renderList();
      checkSectionCompletion(currentSection);
    }

    input.addEventListener("change", function () {
      addFiles(input.files);
      input.value = "";
    });

    dropZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", function () {
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", function (e) {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      addFiles(e.dataTransfer.files);
    });
  }

  setupFileUpload("brand-guidelines-file", "brand-file-list", "brand", null);
  setupFileUpload("brand-logos-file", "logo-file-list", "logo", null);
  setupFileUpload("inspiration-files", "inspo-file-list", "inspo", MAX_INSPO_FILES);
  setupFileUpload("music-files", "music-file-list", "music", null);

  // ---- Summary builder ----
  function buildSummary() {
    var data = getFormData();
    var html = "";

    // Contact
    html += '<h4>Contact Information</h4><dl>';
    var primaryIdx = data.primaryContact || "0";
    if (primaryIdx === "0") {
      html += row("Name (Primary)", (data.contactFirstName || "") + " " + (data.contactLastName || ""));
    } else {
      html += row("Name", (data.contactFirstName || "") + " " + (data.contactLastName || ""));
    }
    html += row("Email", data.contactEmail || "—");
    html += row("Phone", data.contactPhone || "—");
    html += row("Role", data.contactRole || "—");

    // Additional contacts
    for (var ci = 1; ci <= 3; ci++) {
      var fn = data["altContact" + ci + "FirstName"];
      var ln = data["altContact" + ci + "LastName"];
      if (fn || ln) {
        var isPrimary = primaryIdx === String(ci);
        var nameLabel = isPrimary ? "Name (Primary)" : "Name";
        html += row(nameLabel, (fn || "") + " " + (ln || ""));
        html += row("Email", data["altContact" + ci + "Email"] || "—");
        html += row("Role", data["altContact" + ci + "Role"] || "—");
      }
    }

    html += row("Timezone", data.contactTimezone || "—");
    html += row("Preferred Contact", data.preferredContact || "—");
    html += "</dl>";

    // Podcast Basics
    html += '<h4>Podcast Basics</h4><dl>';
    html += row("Podcast Name", data.podcastName || "—");
    html += row("Description", data.podcastDescription || "—");
    html += row("Status", data.podcastStatus === "new" ? "Starting a new podcast" : data.podcastStatus === "existing" ? "Already has an existing podcast" : "—");
    html += row("Brand", data.brandStatus === "existing" ? "Existing brand" : data.brandStatus === "new" ? "New brand" : "—");
    if (data.podcastStatus === "existing") {
      html += row("Existing URL", data.existingPodcastUrl || "—");
      html += row("Existing Podcast Notes", data.existingPodcastNotes || "—");
    }
    html += row("Genre", data.podcastGenre || "—");
    html += row("Format", data.podcastFormat || "—");
    html += row("Target Audience", data.targetAudience || "—");
    html += "</dl>";

    // Branding
    html += '<h4>Branding</h4><dl>';
    var guidelineLabels = { yes: "Yes", no: "Need creation", partial: "Partial" };
    html += row("Has Guidelines", guidelineLabels[data.hasBrandGuidelines] || "—");
    html += row("Brand Colors", data.brandColors || "—");
    html += row("Fonts", data.brandFonts || "—");
    html += row("Voice / Tone", data.brandVoice || "—");
    if (uploadedFiles.brand.length) {
      html += row("Guideline Files", uploadedFiles.brand.map(function (f) { return escapeHtml(f.name); }).join(", "));
    }
    if (uploadedFiles.logo.length) {
      html += row("Logo Files", uploadedFiles.logo.map(function (f) { return escapeHtml(f.name); }).join(", "));
    }
    html += "</dl>";

    // Inspiration
    html += '<h4>Inspiration</h4><dl>';
    if (uploadedFiles.inspo.length) {
      html += row("Images", uploadedFiles.inspo.map(function (f) { return escapeHtml(f.name); }).join(", "));
    }
    html += row("Podcasts Admired", data.inspoPodcasts || "—");
    html += row("Brands Admired", data.inspoBrands || "—");
    html += row("Visual Notes", data.inspoNotes || "—");
    html += "</dl>";

    // Music & Audio
    html += '<h4>Music &amp; Audio</h4><dl>';
    var musicLabels = { yes: "Create from scratch", "have-some": "Have some music", no: "Handle separately", undecided: "TBD" };
    html += row("Needs Music", musicLabels[data.needsMusic] || "—");
    html += row("Music Vibe", data.musicVibe || "—");
    html += row("Music References", data.musicReferences || "—");
    var sfxLabels = { yes: "Yes", minimal: "Minimal", no: "No", undecided: "TBD" };
    html += row("Sound Effects", sfxLabels[data.wantsSFX] || "—");
    if (uploadedFiles.music.length) {
      html += row("Audio Files", uploadedFiles.music.map(function (f) { return escapeHtml(f.name); }).join(", "));
    }
    html += "</dl>";

    // Social Media
    html += '<h4>Social Media &amp; Web</h4><dl>';
    html += row("Website", data.socialWebsite || "—");
    html += row("Instagram", data.socialInstagram || "—");
    html += row("X (Twitter)", data.socialTwitter || "—");
    html += row("TikTok", data.socialTiktok || "—");
    html += row("YouTube", data.socialYoutube || "—");
    html += row("LinkedIn", data.socialLinkedin || "—");
    var socialLabels = { yes: "Full management", partial: "Create content only", no: "Handle ourselves" };
    html += row("Social Mgmt", socialLabels[data.manageSocial] || "—");
    var clipLabels = { yes: "Yes", no: "No", undecided: "TBD" };
    html += row("Short-form Clips", clipLabels[data.wantsClips] || "—");
    html += "</dl>";

    // Recording & Logistics
    html += '<h4>Recording &amp; Logistics</h4><dl>';
    var locLabels = { studio: "Straw Hut Studio", virtual: "Virtual / Remote", "client-location": "Client location", undecided: "TBD" };
    html += row("Location", locLabels[data.recordingLocation] || "—");
    if (data.recordingLocation === "client-location") {
      html += row("Address", data.locationAddress || "—");
    }
    html += row("Frequency", data.episodeFrequency || "—");
    html += row("Episode Length", data.episodeLength || "—");
    html += row("Host(s)", data.hostsInfo || "—");
    var guestLabels = { yes: "Yes, regularly", sometimes: "Sometimes", no: "No", undecided: "TBD" };
    html += row("Guests", guestLabels[data.hasGuests] || "—");
    if (data.hasGuests === "yes" || data.hasGuests === "sometimes") {
      var bookingLabels = { "straw-hut": "Straw Hut handles it", client: "Client handles it", collaborate: "Collaborative", undecided: "TBD" };
      html += row("Guest Booking", bookingLabels[data.guestBooking] || "—");
    }
    var videoLabels = { yes: "Audio + Video", "audio-only": "Audio only", undecided: "TBD" };
    html += row("Video", videoLabels[data.isVideo] || "—");
    if (data.isVideo === "yes") {
      html += row("Video References", data.videoReferences || "—");
    }
    html += row("Launch Date", data.launchDate || "—");
    html += "</dl>";

    // Marketing & Launch
    html += '<h4>Marketing &amp; Launch</h4><dl>';
    var epLabels = { "1": "1 episode", "3": "3 episodes", "5+": "5+ episodes", undecided: "TBD" };
    html += row("Launch Episodes", epLabels[data.launchEpisodes] || "—");
    html += row("Teaser Ideas", data.teaserIdeas || "—");
    html += row("Marketing Notes", data.marketingNotes || "—");
    html += row("Goals", data.goals || "—");
    html += "</dl>";

    formSummary.innerHTML = html;
  }

  function row(label, value) {
    return "<dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd>";
  }

  function getFormData() {
    var data = {};
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name) continue;
      if (el.type === "radio") {
        if (el.checked) data[el.name] = el.value;
      } else if (el.type === "checkbox") {
        // Skip platform checkboxes (handled separately)
        if (el.name !== "platforms") {
          data[el.name] = el.checked;
        }
      } else if (el.type !== "file") {
        data[el.name] = el.value;
      }
    }
    return data;
  }

  function getCheckedValues(name) {
    var values = [];
    var checkboxes = form.querySelectorAll('input[name="' + name + '"]');
    checkboxes.forEach(function (cb) {
      if (cb.checked) values.push(cb.value);
    });
    return values;
  }

  // ---- File conversion helper ----
  function filesToBase64(files) {
    return Promise.all(files.map(function (f) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve({ name: f.name, type: f.type, size: f.size, dataUrl: reader.result });
        };
        reader.onerror = function () {
          resolve({ name: f.name, type: f.type, size: f.size, dataUrl: null });
        };
        reader.readAsDataURL(f);
      });
    }));
  }

  // ---- Google Drive upload ----
  function uploadToDrive(base64Files, category) {
    var endpoint = (typeof SHM_UPLOAD_ENDPOINT !== "undefined") ? SHM_UPLOAD_ENDPOINT : "";
    if (!endpoint || base64Files.length === 0) {
      // No endpoint configured or no files — return files as-is (base64 fallback)
      return Promise.resolve(base64Files);
    }

    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        company: approvedCompany,
        category: category,
        files: base64Files
      })
    })
    .then(function (res) { return res.json(); })
    .then(function (json) {
      if (json.success && json.files) {
        // Merge Drive URLs into file data
        return base64Files.map(function (f, i) {
          var driveInfo = json.files[i] || {};
          return {
            name: f.name,
            type: f.type,
            size: f.size,
            driveId: driveInfo.driveId || null,
            viewUrl: driveInfo.viewUrl || null,
            thumbUrl: driveInfo.thumbUrl || null
          };
        });
      }
      // If upload failed, flag it and fall back to base64
      return base64Files.map(function (f) {
        return { name: f.name, type: f.type, size: f.size, dataUrl: f.dataUrl, uploadFailed: true };
      });
    })
    .catch(function (err) {
      // Network error — flag it and fall back to base64
      console.error("Drive upload failed for category '" + category + "':", err);
      var fallback = base64Files.map(function (f) {
        return { name: f.name, type: f.type, size: f.size, dataUrl: f.dataUrl, uploadFailed: true };
      });
      return fallback;
    });
  }

  // ---- Submit ----
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var confirmBox = document.getElementById("confirm-submit");
    if (!confirmBox.checked) {
      confirmBox.closest(".checkbox-label").style.outline = "1px solid var(--color-error)";
      return;
    }
    confirmBox.closest(".checkbox-label").style.outline = "none";

    // Disable submit to prevent double-click
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    // Convert all uploaded files to base64 first
    Promise.all([
      filesToBase64(uploadedFiles.brand),
      filesToBase64(uploadedFiles.logo),
      filesToBase64(uploadedFiles.inspo),
      filesToBase64(uploadedFiles.music)
    ]).then(function (base64Results) {
      // Upload each category to Google Drive
      return Promise.all([
        uploadToDrive(base64Results[0], "brand-guidelines"),
        uploadToDrive(base64Results[1], "logos"),
        uploadToDrive(base64Results[2], "inspiration"),
        uploadToDrive(base64Results[3], "music")
      ]);
    }).then(function (results) {
      // Mark all sections as completed
      for (var i = 1; i <= totalSections; i++) {
        completedSections[i] = true;
      }
      updateSidebar();
      updateProgress();

      var data = getFormData();
      data.company = approvedCompany;
      data.submittedAt = new Date().toISOString();

      // Store file data (with Drive URLs if available, or base64 fallback)
      data.brandFilesData = results[0];
      data.logoFilesData = results[1];
      data.inspoFilesData = results[2];
      data.musicFilesData = results[3];

      // Also store name-only arrays for backward compat / email
      data.brandFiles = uploadedFiles.brand.map(function (f) { return f.name; });
      data.logoFiles = uploadedFiles.logo.map(function (f) { return f.name; });
      data.inspoFiles = uploadedFiles.inspo.map(function (f) { return f.name; });
      data.musicFiles = uploadedFiles.music.map(function (f) { return f.name; });

      // Save submission to Google Sheets backend
      saveSubmission(data);

      // Send email notification via FormSubmit.co
      sendEmailNotification(data);

      // Clear the draft since form is submitted
      clearFormDraft();

      // Check if any file uploads failed
      var allFiles = [].concat(results[0], results[1], results[2], results[3]);
      var anyFailed = allFiles.some(function (f) { return f && f.uploadFailed; });
      if (anyFailed) {
        var warning = document.createElement("div");
        warning.className = "upload-warning";
        warning.style.cssText = "background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:12px 16px;border-radius:8px;margin:16px 0;font-size:14px;";
        warning.innerHTML = "<strong>Note:</strong> Some files could not be uploaded to Google Drive. Your form was still submitted successfully. Please email your files directly to <a href='mailto:onboarding@strawhutmedia.com'>onboarding@strawhutmedia.com</a>.";
        successScreen.insertBefore(warning, successScreen.children[1] || null);
      }

      // Show success screen
      switchScreen(successScreen);
    });
  });

  // ---- Save submission to Google Sheets backend ----
  function saveSubmission(data) {
    var endpoint = (typeof SHM_UPLOAD_ENDPOINT !== "undefined") ? SHM_UPLOAD_ENDPOINT : "";
    if (endpoint) {
      // Strip base64 dataUrl from file data before saving (too large for Sheets)
      var cleanData = JSON.parse(JSON.stringify(data));
      ["brandFilesData", "logoFilesData", "inspoFilesData", "musicFilesData"].forEach(function (key) {
        if (cleanData[key] && Array.isArray(cleanData[key])) {
          cleanData[key] = cleanData[key].map(function (f) {
            return { name: f.name, type: f.type, size: f.size, driveId: f.driveId, viewUrl: f.viewUrl, thumbUrl: f.thumbUrl };
          });
        }
      });

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveSubmission", data: cleanData })
      }).then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success) {
            console.log("Submission saved to backend, ID:", json.id);
          } else {
            console.warn("Backend save failed:", json.error);
          }
        }).catch(function (err) {
          console.warn("Could not save submission to backend:", err);
        });
    }
  }

  // ---- Send email via FormSubmit.co ----
  function sendEmailNotification(data) {
    var email = (typeof SHM_NOTIFICATION_EMAIL !== "undefined") ? SHM_NOTIFICATION_EMAIL : "onboarding@strawhutmedia.com";
    var endpoint = "https://formsubmit.co/ajax/" + email;

    // Build a readable email body
    var body = "NEW PODCAST ONBOARDING SUBMISSION\n";
    body += "Company: " + (data.company || "Unknown") + "\n";
    body += "Submitted: " + new Date(data.submittedAt).toLocaleString() + "\n\n";

    body += "--- CONTACT INFORMATION ---\n";
    var primaryIdx = data.primaryContact || "0";
    body += "Primary Contact: " + (primaryIdx === "0" ? "Main" : "Additional #" + primaryIdx) + "\n";
    body += "Name: " + (data.contactFirstName || "") + " " + (data.contactLastName || "") + "\n";
    body += "Email: " + (data.contactEmail || "Not provided") + "\n";
    body += "Phone: " + (data.contactPhone || "Not provided") + "\n";
    body += "Role: " + (data.contactRole || "Not provided") + "\n";

    for (var ci = 1; ci <= 3; ci++) {
      var fn = data["altContact" + ci + "FirstName"];
      var ln = data["altContact" + ci + "LastName"];
      if (fn || ln) {
        body += "\nAdditional Contact " + ci + ":\n";
        body += "  Name: " + (fn || "") + " " + (ln || "") + "\n";
        body += "  Email: " + (data["altContact" + ci + "Email"] || "Not provided") + "\n";
        body += "  Role: " + (data["altContact" + ci + "Role"] || "Not provided") + "\n";
      }
    }

    body += "Timezone: " + (data.contactTimezone || "Not provided") + "\n";
    body += "Preferred Contact: " + (data.preferredContact || "Not provided") + "\n\n";

    body += "--- PODCAST BASICS ---\n";
    body += "Podcast Name: " + (data.podcastName || "Not provided") + "\n";
    body += "Description: " + (data.podcastDescription || "Not provided") + "\n";
    body += "Status: " + (data.podcastStatus || "Not provided") + "\n";
    body += "Brand Status: " + (data.brandStatus || "Not provided") + "\n";
    body += "Genre: " + (data.podcastGenre || "Not provided") + "\n";
    body += "Format: " + (data.podcastFormat || "Not provided") + "\n";
    body += "Target Audience: " + (data.targetAudience || "Not provided") + "\n\n";

    body += "--- BRANDING ---\n";
    body += "Has Guidelines: " + (data.hasBrandGuidelines || "Not provided") + "\n";
    body += "Brand Colors: " + (data.brandColors || "Not provided") + "\n";
    body += "Fonts: " + (data.brandFonts || "Not provided") + "\n";
    body += "Voice/Tone: " + (data.brandVoice || "Not provided") + "\n";
    if (data.brandFiles && data.brandFiles.length) body += "Brand Files: " + data.brandFiles.join(", ") + "\n";
    if (data.logoFiles && data.logoFiles.length) body += "Logo Files: " + data.logoFiles.join(", ") + "\n";
    body += "\n";

    body += "--- INSPIRATION ---\n";
    body += "Podcasts Admired: " + (data.inspoPodcasts || "Not provided") + "\n";
    body += "Brands Admired: " + (data.inspoBrands || "Not provided") + "\n";
    body += "Visual Notes: " + (data.inspoNotes || "Not provided") + "\n";
    if (data.inspoFiles && data.inspoFiles.length) body += "Inspiration Files: " + data.inspoFiles.join(", ") + "\n";
    body += "\n";

    body += "--- MUSIC & AUDIO ---\n";
    body += "Needs Music: " + (data.needsMusic || "Not provided") + "\n";
    body += "Music Vibe: " + (data.musicVibe || "Not provided") + "\n";
    body += "Music References: " + (data.musicReferences || "Not provided") + "\n";
    body += "Sound Effects: " + (data.wantsSFX || "Not provided") + "\n";
    if (data.musicFiles && data.musicFiles.length) body += "Music Files: " + data.musicFiles.join(", ") + "\n";
    body += "\n";

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
    if (data.hasGuests === "yes" || data.hasGuests === "sometimes") {
      body += "Guest Booking: " + (data.guestBooking || "Not provided") + "\n";
    }
    body += "Video: " + (data.isVideo || "Not provided") + "\n";
    if (data.isVideo === "yes") {
      body += "Video References: " + (data.videoReferences || "Not provided") + "\n";
    }
    body += "Launch Date: " + (data.launchDate || "Not provided") + "\n\n";

    body += "--- MARKETING & LAUNCH ---\n";
    body += "Launch Episodes: " + (data.launchEpisodes || "Not provided") + "\n";
    body += "Teaser Ideas: " + (data.teaserIdeas || "Not provided") + "\n";
    body += "Marketing Notes: " + (data.marketingNotes || "Not provided") + "\n";
    body += "Goals: " + (data.goals || "Not provided") + "\n\n";

    body += "--- ADDITIONAL ---\n";
    body += "Anything Else: " + (data.anythingElse || "Not provided") + "\n";

    var formData = new FormData();
    formData.append("_subject", "New Onboarding: " + (data.company || "Unknown Company") + " — " + (data.podcastName || "Unnamed Podcast"));
    formData.append("Company", data.company || "");
    formData.append("Contact", (data.contactFirstName || "") + " " + (data.contactLastName || ""));
    formData.append("Email", data.contactEmail || "");
    formData.append("Phone", data.contactPhone || "");
    formData.append("Podcast Name", data.podcastName || "");
    formData.append("message", body);
    formData.append("_template", "box");

    fetch(endpoint, {
      method: "POST",
      body: formData,
      headers: { "Accept": "application/json" }
    }).then(function (res) {
      if (res.ok) {
        console.log("Email notification sent successfully.");
      } else {
        console.warn("Email notification failed:", res.status);
      }
    }).catch(function (err) {
      console.warn("Email notification error:", err);
    });
  }

  // ---- Utils ----
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

})();
