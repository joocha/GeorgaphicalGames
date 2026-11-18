/* GeoAIGames documentation: mobile navigation, version selector and search.
   Pages are complete without JavaScript; this file only adds convenience. */
(function () {
  "use strict";
  var body = document.body;
  var $ = function (id) { return document.getElementById(id); };

  // ---- mobile navigation ----
  var menuBtn = $("menuBtn"), scrim = $("scrim");
  function setNav(open) {
    body.classList.toggle("nav-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
  }
  menuBtn.addEventListener("click", function () { setNav(!body.classList.contains("nav-open")); });
  scrim.addEventListener("click", function () { setNav(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setNav(false); });

  // ---- version selector: same page in the chosen version ----
  var select = $("versionSelect");
  select.addEventListener("change", function () {
    var page = body.dataset.page;
    var target = select.value + (page && page !== "changelog" ? page + ".html" : "index.html");
    // Fall back to the version's start page if this page doesn't exist there.
    fetch(target, { method: "HEAD" }).then(function (r) {
      location.href = r.ok ? target : select.value + "index.html";
    }, function () { location.href = target; });
  });

  // ---- search ----
  var input = $("searchInput"), results = $("searchResults");
  var index = null, loading = null, selected = -1;
  var indexUrl = body.dataset.search;
  // Search result links are relative to the folder of the search index.
  var indexBase = indexUrl.replace(/[^/]*$/, "");

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(indexUrl).then(function (r) { return r.json(); }).then(function (data) {
        index = [];
        data.forEach(function (page) {
          page.sections.forEach(function (s, k) {
            index.push({
              title: page.title, heading: s.heading, text: s.text,
              url: indexBase + page.url + (k === 0 ? "" : "#" + s.anchor),
              hay: (page.title + " " + s.heading + " " + s.text).toLowerCase()
            });
          });
        });
        return index;
      });
    }
    return loading;
  }

  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mark(text, terms) {
    var out = esc(text);
    terms.forEach(function (t) {
      if (t.length < 2) return;
      out = out.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
    });
    return out;
  }
  function snippet(text, terms) {
    var low = text.toLowerCase(), at = -1;
    for (var i = 0; i < terms.length && at < 0; i++) at = low.indexOf(terms[i]);
    var start = Math.max(0, at - 50);
    return (start ? "…" : "") + text.slice(start, start + 160) + (text.length > start + 160 ? "…" : "");
  }

  function search(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) { results.hidden = true; return; }
    load().then(function (idx) {
      var hits = idx.map(function (e) {
        var score = 0;
        for (var i = 0; i < terms.length; i++) {
          var t = terms[i];
          if (e.hay.indexOf(t) < 0) return null;
          if (e.heading.toLowerCase().indexOf(t) >= 0) score += 5;
          if (e.title.toLowerCase().indexOf(t) >= 0) score += 2;
          score += 1;
        }
        return { e: e, score: score };
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
      selected = -1;
      results.innerHTML = hits.length ? hits.map(function (h, k) {
        var e = h.e;
        return '<a role="option" id="sr' + k + '" href="' + e.url + '"><b>' + mark(e.heading, terms) +
          (e.heading !== e.title ? ' <small style="display:inline">· ' + esc(e.title) + "</small>" : "") +
          "</b><small>" + mark(snippet(e.text, terms), terms) + "</small></a>";
      }).join("") : '<div class="empty">No results for “' + esc(q) + '”.</div>';
      results.hidden = false;
    }, function () {
      results.innerHTML = '<div class="empty">Search is not available.</div>';
      results.hidden = false;
    });
  }

  var timer;
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { search(input.value.trim()); }, 120); });
  input.addEventListener("focus", function () { load(); if (input.value.trim()) search(input.value.trim()); });
  input.addEventListener("keydown", function (e) {
    var links = results.querySelectorAll("a");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!links.length) return;
      e.preventDefault();
      selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links.forEach(function (a, k) { a.setAttribute("aria-selected", String(k === selected)); });
      links[selected].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && links.length) {
      e.preventDefault();
      location.href = links[Math.max(0, selected)].getAttribute("href");
    } else if (e.key === "Escape") {
      results.hidden = true; input.blur();
    }
  });
  document.addEventListener("click", function (e) { if (!e.target.closest(".search")) results.hidden = true; });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); input.focus();
    }
  });
})();
