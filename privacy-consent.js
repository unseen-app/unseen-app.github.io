const consentKey = "unseen.analytics-consent.v1";
const banner = document.querySelector("#privacy-banner");
const accept = document.querySelector("#privacy-accept");
const decline = document.querySelector("#privacy-decline");
const settings = document.querySelector("#privacy-settings");

function readChoice() {
  try { return localStorage.getItem(consentKey); }
  catch { return null; }
}

function saveChoice(value) {
  try { localStorage.setItem(consentKey, value); }
  catch { /* Apply the choice for this page view even if storage is unavailable. */ }
}

function loadAnalytics() {
  if (document.querySelector("script[data-unseen-analytics]")) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://cloud.umami.is/script.js";
  script.dataset.unseenAnalytics = "true";
  script.dataset.websiteId = "444cec39-32c9-467d-bd17-d0946e998798";
  script.dataset.domains = "unseen-app.github.io";
  script.dataset.excludeHash = "true";
  script.dataset.excludeSearch = "true";
  document.head.append(script);
}

function showBanner() {
  banner.hidden = false;
  accept.focus();
}

function choose(value) {
  const previous = readChoice();
  saveChoice(value);
  banner.hidden = true;
  if (previous === "yes" && value === "no") {
    location.reload();
    return;
  }
  if (value === "yes") loadAnalytics();
}

if (readChoice() === "yes") loadAnalytics();
else if (readChoice() !== "no") showBanner();

accept.addEventListener("click", () => choose("yes"));
decline.addEventListener("click", () => choose("no"));
settings.addEventListener("click", showBanner);
