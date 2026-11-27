/* Runs before first paint: theme, and refuse to render inside a frame (clickjacking). */
(function () {
  var d = document.documentElement, t;
  if (window.top !== window.self) { d.style.display = "none"; try { window.top.location = window.self.location; } catch (e) {} }
  try { t = localStorage.getItem("theme"); } catch (e) {}
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  d.setAttribute("data-theme", t);
  d.classList.add("js");
})();
