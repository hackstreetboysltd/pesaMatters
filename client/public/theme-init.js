(function () {
  var pref = "system";
  try {
    var stored = localStorage.getItem("hackstreet-appearance");
    if (stored === "light") pref = "kiln";
    else if (stored === "dark") pref = "after-hours";
    else if (
      stored === "system" ||
      stored === "kiln" ||
      stored === "after-hours" ||
      stored === "coast" ||
      stored === "fare" ||
      stored === "brew"
    ) {
      pref = stored;
    }
  } catch (e) {
    pref = "system";
  }
  var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = pref === "system" ? (dark ? "after-hours" : "kiln") : pref;
  document.documentElement.setAttribute("data-appearance", pref);
  document.documentElement.setAttribute("data-theme", theme);
  var colors = {
    kiln: "#E4D2BC",
    "after-hours": "#12100E",
    coast: "#C5DBD3",
    fare: "#12151C",
    brew: "#2C1A12",
  };
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", colors[theme] || colors.kiln);
})();
