const form = document.querySelector("#route-form");
const field = document.querySelector("#route-url");
const state = document.querySelector("#route-state");
const screen = document.querySelector("#route-screen");
const elapsed = document.querySelector("#route-time");
const address = document.querySelector("#route-address");
const captured = document.querySelector("#route-captured");
const button = form.querySelector("button");
const sites = new Set(["web.telegram.org", "youtube.com"]);
function show(icon, title, description) {
  const symbol = document.createElement("span");
  symbol.className = "demo-symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = icon;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const caption = document.createElement("span");
  caption.textContent = description;
  screen.classList.remove("has-preview");
  screen.replaceChildren(symbol, heading, caption);
}
async function simulate() {
  if (button.disabled) return;
  let host;
  try {
    const value = field.value.trim();
    const url = new URL(value.includes("://") ? value : "https://" + value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error();
    host = url.hostname.replace(/^www\./, "");
  } catch {
    state.textContent = "Проверь адрес";
    state.dataset.status = "error";
    elapsed.textContent = "";
    show("!", "Адрес не распознан", "Введи, например, web.telegram.org");
    return;
  }
  address.textContent = host;
  captured.textContent = "Просмотр через Unseen";
  elapsed.textContent = "";
  if (!sites.has(host)) {
    state.textContent = "Адрес вне списка демонстрации";
    state.dataset.status = "error";
    show("!", "Выбери сайт для проверки", "Сейчас доступны Telegram Web и YouTube");
    return;
  }
  button.disabled = true;
  state.dataset.status = "pending";
  state.textContent = "Открываем через Unseen";
  show("…", "Загружаем страницу", "Обычно это занимает несколько секунд");
  try {
    const response = await fetch("https://unseen-site-demo.ravin3657345.workers.dev/preview?host=" + encodeURIComponent(host), {cache:"no-store",signal:AbortSignal.timeout(50000)});
    if (!response.ok) {
      const result = await response.json();
      throw Error(result.error);
    }
    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(await response.blob());
    image.onload = image.onerror = () => URL.revokeObjectURL(objectUrl);
    image.alt = "Снимок загруженной страницы " + host;
    image.src = objectUrl;
    await image.decode();
    screen.classList.add("has-preview");
    screen.replaceChildren(image);
    state.dataset.status = "success";
    state.textContent = "Открыто через Unseen";
    const duration = Number(response.headers.get("X-Preview-Time"));
    elapsed.textContent = new Intl.NumberFormat("ru", {maximumFractionDigits:1}).format(duration) + " с";
    const timestamp = new Date(response.headers.get("X-Preview-Captured"));
    if (Number.isFinite(timestamp.getTime())) {
      captured.textContent = "Снимок · " + new Intl.DateTimeFormat("ru", {dateStyle:"short",timeStyle:"short"}).format(timestamp);
    }
  } catch (error) {
    state.dataset.status = "error";
    state.textContent = "Не удалось загрузить";
    show("!", "Страница пока не открылась", error.message);
  } finally {
    button.disabled = false;
  }
}
form.addEventListener("submit", event => { event.preventDefault(); void simulate(); });
document.querySelectorAll("[data-host]").forEach(item => item.addEventListener("click", () => {
  if (button.disabled) return;
  field.value = item.dataset.host;
  void simulate();
}));
