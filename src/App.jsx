import React, { useState, useEffect, useRef, useContext, createContext, useMemo } from "react";
import { ChevronRight, ChevronLeft, ChevronDown, Search, X, Zap, FileText, Calendar, CalendarDays, Menu, Plus, Link2, Trash2, Star, MoreHorizontal, Bold, Italic, Copy as CopyIcon, GripVertical, Maximize2, ChevronsDown, ChevronsUp, LayoutList, AlignLeft, Clock, ListOrdered, CheckSquare, Highlighter, Lock } from "lucide-react";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

let idCounter = 1;
const genId = (p = "b") => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function slugify(s) {
  return (
    (s || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "untitled"
  );
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* Detects a leading "[ ] " / "[x] " checkbox marker on a block's raw text */
function parseTodo(text) {
  if (!text) return { isTodo: false, checked: false, rest: text || "" };
  if (text.slice(0, 4) === "[ ] ") return { isTodo: true, checked: false, rest: text.slice(4) };
  if (/^\[x\] /i.test(text)) return { isTodo: true, checked: true, rest: text.slice(4) };
  return { isTodo: false, checked: false, rest: text };
}

/* Strips whichever leading block-type marker ("[ ] ", "[x] ", "# ", "> ") is present, if any */
function stripBlockPrefix(text) {
  if (!text) return text || "";
  if (text.slice(0, 4) === "[ ] " || /^\[x\] /i.test(text)) return text.slice(4);
  if (text.slice(0, 2) === "# ") return text.slice(2);
  if (text.slice(0, 2) === "> ") return text.slice(2);
  return text;
}

function parseHeader(text) {
  if (text && text.slice(0, 2) === "# ") return { isHeader: true, rest: text.slice(2) };
  return { isHeader: false, rest: text || "" };
}

function parseQuote(text) {
  if (text && text.slice(0, 2) === "> ") return { isQuote: true, rest: text.slice(2) };
  return { isQuote: false, rest: text || "" };
}

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDailyTitle(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function ordinalSuffix(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatInlineDate(d) {
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month} ${day}${ordinalSuffix(day)}, ${year}`;
}

function formatInlineTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const ENCRYPTED_MARKER = "{{encrypted}}";

function bufToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveEncryptionKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBlockText(plainText, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(passphrase, salt);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plainText));
  return { salt: bufToBase64(salt), iv: bufToBase64(iv), cipher: bufToBase64(cipherBuf) };
}

async function decryptBlockText(payload, passphrase) {
  const salt = new Uint8Array(base64ToBuf(payload.salt));
  const iv = new Uint8Array(base64ToBuf(payload.iv));
  const key = await deriveEncryptionKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBuf(payload.cipher));
  return new TextDecoder().decode(plainBuf);
}

function detectTrigger(text, cursor) {
  const before = text.slice(0, cursor);
  const lastOpenPage = before.lastIndexOf("[[");
  const lastClosePage = before.lastIndexOf("]]");
  if (lastOpenPage !== -1 && lastOpenPage > lastClosePage) {
    return { type: "page", start: lastOpenPage + 2, query: before.slice(lastOpenPage + 2) };
  }
  const lastOpenBlock = before.lastIndexOf("((");
  const lastCloseBlock = before.lastIndexOf("))");
  if (lastOpenBlock !== -1 && lastOpenBlock > lastCloseBlock) {
    return { type: "block", start: lastOpenBlock + 2, query: before.slice(lastOpenBlock + 2) };
  }
  const lastSlash = before.lastIndexOf("/");
  if (lastSlash !== -1) {
    const charBefore = lastSlash === 0 ? "" : before[lastSlash - 1];
    const afterSlash = before.slice(lastSlash + 1);
    if ((charBefore === "" || /\s/.test(charBefore)) && !/\s/.test(afterSlash)) {
      return { type: "slash", start: lastSlash + 1, query: afterSlash };
    }
  }
  return null;
}

function countRefs(blocks, id) {
  let n = 0;
  const needle = `((${id}))`;
  for (const b of Object.values(blocks)) {
    if (b.text && b.text.includes(needle)) n++;
  }
  return n;
}

/* Extract every [[Title]] mentioned in a block's text */
function extractPageLinks(text) {
  if (!text) return [];
  const re = /\[\[([^\]]+)\]\]/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/* All blocks (anywhere in the database) that formally link to a given page, grouped by source page.
   This is the associative "web" the whole app is built around: it's how a page shows every place
   in the database that has been connected back to it, regardless of hierarchy or folder. */
function pageBacklinks(blocks, pageId) {
  const result = [];
  Object.values(blocks).forEach((b) => {
    if (!b.text || b.id.startsWith("root-")) return;
    const titles = extractPageLinks(b.text);
    if (titles.some((t) => "p-" + slugify(t) === pageId)) result.push(b);
  });
  return result;
}

/* Extract every ![alt](url) image reference from a block's text, for live preview while editing */
function extractImageRefs(text) {
  if (!text) return [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push({ alt: m[1], url: m[2] });
  return out;
}

/* Mirrors a textarea's text up to `position` in a hidden div to read off the pixel
   coordinates of that point, so we can position a floating toolbar above a selection. */
function getCaretCoordinates(el, position) {
  const div = document.createElement("div");
  const style = div.style;
  const computed = window.getComputedStyle(el);
  const properties = [
    "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight",
    "fontSize", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "textDecoration",
    "letterSpacing", "wordSpacing",
  ];
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "-9999px";
  properties.forEach((prop) => {
    style[prop] = computed[prop];
  });
  document.body.appendChild(div);
  const value = el.value;
  div.textContent = value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = value.substring(position) || ".";
  div.appendChild(span);
  const coordinates = {
    top: span.offsetTop + parseInt(computed["borderTopWidth"] || "0", 10) - el.scrollTop,
    left: span.offsetLeft + parseInt(computed["borderLeftWidth"] || "0", 10) - el.scrollLeft,
  };
  document.body.removeChild(div);
  return coordinates;
}

/* Render a block's raw text into React nodes, turning [[links]], ((refs)), #tags,
   ![images/gifs](url) and [links](url) (plus bare URLs) into interactive elements */
function renderInline(text, { blocks, onPage, onBlockRef, blockId, onImageResize }) {
  if (!text) return null;
  const regex =
    /(?<pagelink>\[\[(?<pagetitle>[^\]]+)\]\])|(?<blockref>\(\((?<refid>[^)]+)\)\))|(?<tag>#[\w-]+)|(?<image>!\[(?<imgalt>[^\]]*)\]\((?<imgurl>[^)]+)\)(?:\{(?<imgwidth>\d+)\})?)|(?<mdlink>\[(?<linktext>[^\]]+)\]\((?<linkurl>[^)]+)\))|(?<bareurl>https?:\/\/[^\s)]+)|(?<highlight>==(?<highlighttext>[^=]+)==)|(?<bold>\*\*(?<boldtext>[^*]+)\*\*)|(?<italic>\*(?<italictext>[^*]+)\*)|(?<comment>\/\/(?<commenttext>[^\n]*))/g;
  const out = [];
  let last = 0;
  let m;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const g = m.groups;
    if (g.pagelink !== undefined) {
      const title = g.pagetitle;
      out.push(
        <span
          key={key++}
          className="rr-link"
          onClick={(e) => {
            e.stopPropagation();
            onPage(title, e.shiftKey);
          }}
        >
          {title}
        </span>
      );
    } else if (g.blockref !== undefined) {
      const rid = g.refid;
      const refBlock = blocks[rid];
      const preview = refBlock ? truncate(refBlock.text || "(empty block)", 60) : "missing reference";
      out.push(
        <span
          key={key++}
          className="rr-refchip"
          onClick={(e) => {
            e.stopPropagation();
            onBlockRef(rid, e.shiftKey);
          }}
        >
          {preview}
        </span>
      );
    } else if (g.tag !== undefined) {
      out.push(
        <span key={key++} className="rr-tag">
          {g.tag}
        </span>
      );
    } else if (g.image !== undefined) {
      const alt = g.imgalt;
      const url = g.imgurl;
      const width = g.imgwidth ? parseInt(g.imgwidth, 10) : null;
      const fullMatch = g.image;
      out.push(
        <span
          key={key++}
          className="rr-inline-img-wrap"
          style={width ? { width: width + "px", height: Math.round(width * 0.66) + "px" } : undefined}
          onClick={(e) => e.stopPropagation()}
          onMouseUp={(e) => {
            if (!onImageResize || !blockId) return;
            const el = e.currentTarget;
            const newWidth = Math.round(el.getBoundingClientRect().width);
            if (!width || Math.abs(newWidth - width) > 2) {
              onImageResize(blockId, fullMatch, `![${alt}](${url}){${newWidth}}`);
            }
          }}
          title="Drag the bottom-right corner to resize"
        >
          <img src={url} alt={alt || "image"} className="rr-inline-img" loading="lazy" />
        </span>
      );
    } else if (g.mdlink !== undefined) {
      const linkText = g.linktext;
      const url = g.linkurl;
      out.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rr-inline-link"
          onClick={(e) => e.stopPropagation()}
        >
          {linkText}
        </a>
      );
    } else if (g.bareurl !== undefined) {
      const url = g.bareurl;
      out.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rr-inline-link"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
    } else if (g.bold !== undefined) {
      out.push(<strong key={key++}>{g.boldtext}</strong>);
    } else if (g.italic !== undefined) {
      out.push(<em key={key++}>{g.italictext}</em>);
    } else if (g.highlight !== undefined) {
      out.push(
        <mark key={key++} className="rr-highlight">
          {g.highlighttext}
        </mark>
      );
    } else if (g.comment !== undefined) {
      out.push(
        <span key={key++} className="rr-comment">
          //{g.commenttext}
        </span>
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>);
  return out;
}

/* ---------------------------------------------------------------------- */
/* Seed data                                                               */
/* ---------------------------------------------------------------------- */

function seedData() {
  const pages = {};
  const blocks = {};
  const seedCreatedAt = new Date("2021-01-11T09:00:00").getTime();
  const mkRoot = (pageId) => {
    const rid = "root-" + pageId;
    blocks[rid] = { id: rid, pageId, parentId: null, text: "", children: [], createdAt: seedCreatedAt };
    return rid;
  };
  const mk = (id, pageId, parentId, text) => {
    blocks[id] = { id, pageId, parentId, text, children: [], createdAt: seedCreatedAt };
    return id;
  };

  const homeId = "p-how-to-work-from-home-effectively";
  const homeRoot = mkRoot(homeId);
  mk("b1", homeId, homeRoot, "Series");
  mk(
    "b2",
    homeId,
    "b1",
    "This will be a general primer series on how to work from home effectively. I'm making this because a lot of people are going to have to start working from home now with [[Coronavirus]] going around."
  );
  mk(
    "b3",
    homeId,
    "b1",
    "We'll talk about planning and prioritization, how to stay motivated and productive, how to set up your work space and keep it away from other things, and talk about tools that can enable better remote work."
  );
  mk(
    "b4",
    homeId,
    "b1",
    "The sponsor for this one is [[Skillshare]] - definitely will be plugging my habits course, as learning how to build healthy routines is ESSENTIAL for [[Productivity]] working from home effectively over the long run."
  );
  blocks["b1"].children = ["b2", "b3", "b4"];

  mk("b5", homeId, homeRoot, "Sections");
  mk("b6", homeId, "b5", "Intro notes");
  blocks["b5"].children = ["b6"];
  mk(
    "b7",
    homeId,
    "b6",
    "If you're not used to working from home, it can be difficult to focus and to stay productive. Don't beat yourself up about this - building a habit of working productively at home takes practice and time. You can do it! ((b2))"
  );
  blocks["b6"].children = ["b7"];
  mk("b8", homeId, homeRoot, "Work from home tools");
  mk("b9", homeId, "b8", "Communication: Slack, Zoom, email");
  mk("b10", homeId, "b8", "Focus: a dedicated [[Productivity]] playlist and a closed door");
  blocks["b8"].children = ["b9", "b10"];

  blocks[homeRoot].children = ["b1", "b5", "b8"];
  pages[homeId] = { id: homeId, title: "How to Work From Home Effectively", rootBlockId: homeRoot, isDaily: false, starred: true };

  const ssId = "p-skillshare";
  const ssRoot = mkRoot(ssId);
  mk(
    "s1",
    ssId,
    ssRoot,
    "Skillshare is the sponsor of the [[How to Work From Home Effectively]] series, since coronavirus disrupted so many workplaces this year."
  );
  mk("t1", ssId, ssRoot, "{{table}}");
  mk("r1", ssId, "t1", "");
  mk("c1", ssId, "r1", "Feature");
  mk("c2", ssId, "r1", "Status");
  blocks["r1"].children = ["c1", "c2"];
  mk("r2", ssId, "t1", "");
  mk("c3", ssId, "r2", "Focus Mode");
  mk("c4", ssId, "r2", "Shipped");
  blocks["r2"].children = ["c3", "c4"];
  mk("r3", ssId, "t1", "");
  mk("c5", ssId, "r3", "Graph Overview");
  mk("c6", ssId, "r3", "Shipped");
  blocks["r3"].children = ["c5", "c6"];
  blocks["t1"].children = ["r1", "r2", "r3"];
  blocks[ssRoot].children = ["s1", "t1"];
  pages[ssId] = { id: ssId, title: "Skillshare", rootBlockId: ssRoot, isDaily: false, starred: true };

  const prodId = "p-productivity";
  const prodRoot = mkRoot(prodId);
  mk("pr1", prodId, prodRoot, "A collection of notes on staying productive while working from home.");
  blocks[prodRoot].children = ["pr1"];
  pages[prodId] = { id: prodId, title: "Productivity", rootBlockId: prodRoot, isDaily: false, starred: false };

  return { pages, blocks };
}

/* ---------------------------------------------------------------------- */
/* Context                                                                 */
/* ---------------------------------------------------------------------- */

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

/* ---------------------------------------------------------------------- */
/* Small presentational bits                                               */
/* ---------------------------------------------------------------------- */

function Bullet({ onClick, filled }) {
  return (
    <button className="rr-bullet" onClick={onClick} title="Block options">
      <span className={filled ? "rr-bullet-dot rr-bullet-dot-filled" : "rr-bullet-dot"} />
    </button>
  );
}

/* Dropdown menu shown when a block's bullet is clicked - page/block level actions,
   modeled after Roam's bullet context menu. */
function BulletMenu({ id, onClose }) {
  const {
    pages,
    blocks,
    setFocusedBlockId,
    openInSidebar,
    toggleStarPage,
    expandAll,
    collapseAll,
    setViewMode,
    viewModeBlocks,
    setView,
    setCurrentPageId,
    commitEdit,
  } = useApp();
  const wrapRef = useRef(null);
  const block = blocks[id];

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!block) return null;
  const page = pages[block.pageId];
  const ownMode = viewModeBlocks.get(id) || "bullet";
  const todo = parseTodo(block.text);
  const createdLabel = new Date(block.createdAt || Date.now()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function act(fn) {
    return () => {
      fn();
      onClose();
    };
  }

  return (
    <div className="rr-bulletmenu-dropdown" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      {page && (
        <button
          className="rr-bulletmenu-item"
          onClick={act(() => {
            toggleStarPage(page.id);
          })}
        >
          <Star size={13} fill={page.starred ? "currentColor" : "none"} /> {page.starred ? "Unstar Page" : "Star Page"}
        </button>
      )}
      <button className="rr-bulletmenu-item" onClick={act(() => setFocusedBlockId(id))}>
        <Maximize2 size={13} /> Zoom into block
      </button>
      <button className="rr-bulletmenu-item" onClick={act(() => openInSidebar("block", id))}>
        <Link2 size={13} /> Open in Sidebar
      </button>
      <button
        className={"rr-bulletmenu-item" + (todo.isTodo ? " rr-bulletmenu-item-active" : "")}
        onClick={act(() => commitEdit(id, todo.isTodo ? todo.rest : "[ ] " + block.text))}
      >
        <CheckSquare size={13} /> {todo.isTodo ? "Remove Todo" : "Make Todo"}
      </button>
      <button className="rr-bulletmenu-item" onClick={act(() => expandAll(id))}>
        <ChevronsDown size={13} /> Expand all
      </button>
      <button className="rr-bulletmenu-item" onClick={act(() => collapseAll(id))}>
        <ChevronsUp size={13} /> Collapse all
      </button>
      <button
        className={"rr-bulletmenu-item" + (ownMode === "document" ? " rr-bulletmenu-item-active" : "")}
        onClick={act(() => setViewMode(id, "document"))}
      >
        <AlignLeft size={13} /> View as Document
      </button>
      <button
        className={"rr-bulletmenu-item" + (ownMode === "numbered" ? " rr-bulletmenu-item-active" : "")}
        onClick={act(() => setViewMode(id, "numbered"))}
      >
        <ListOrdered size={13} /> View as Numbered List
      </button>
      <button
        className={"rr-bulletmenu-item" + (ownMode === "bullet" ? " rr-bulletmenu-item-active" : "")}
        onClick={act(() => setViewMode(id, "bullet"))}
      >
        <LayoutList size={13} /> View as Bulleted List
      </button>
      <div className="rr-bulletmenu-item rr-bulletmenu-item-static">
        <Clock size={13} /> Created on {createdLabel}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Block editor (textarea + autocomplete)                                  */
/* ---------------------------------------------------------------------- */

function SuggestDropdown({ blockId, trigger, onSelect }) {
  const { pages, blocks, applyTrigger } = useApp();
  const select = onSelect || ((item) => applyTrigger(blockId, trigger, item));
  let items = [];
  if (trigger.type === "page") {
    const q = trigger.query.toLowerCase();
    items = Object.values(pages)
      .filter((p) => p.title.toLowerCase().includes(q))
      .slice(0, 7);
    if (trigger.query && !items.some((p) => p.title.toLowerCase() === q)) {
      items = [...items, { id: "__new__", title: trigger.query, isNew: true }];
    }
  } else if (trigger.type === "slash") {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const all = [
      { id: "header1", label: "Header 1", sub: "Big bold heading", action: "header1" },
      { id: "header0", label: "Remove Header", sub: "Back to normal text (Alt+0)", action: "header0" },
      { id: "quote", label: "Quote", sub: "Turn into a block quote", action: "quote" },
      { id: "hr", label: "Divider", sub: "Horizontal line (or type ---)", action: "hr" },
      { id: "pomodoro", label: "Pomodoro Timer", sub: "25-minute focus timer", action: "pomodoro" },
      { id: "encrypt", label: "Encrypt Block", sub: "Lock this block with a passphrase", action: "encrypt" },
      { id: "upload", label: "Upload from Device", sub: "Insert an image file" },
      { id: "link", label: "Link", sub: "Insert a link by URL" },
      { id: "image", label: "Image from URL", sub: "Insert an image by URL" },
      { id: "gif", label: "GIF from URL", sub: "Insert a GIF by URL" },
      { id: "today", label: "Today", sub: formatInlineDate(now), value: formatInlineDate(now) },
      { id: "tomorrow", label: "Tomorrow", sub: formatInlineDate(tomorrow), value: formatInlineDate(tomorrow) },
      { id: "yesterday", label: "Yesterday", sub: formatInlineDate(yesterday), value: formatInlineDate(yesterday) },
      { id: "time", label: "Current Time", sub: formatInlineTime(now), value: formatInlineTime(now) },
    ];
    const q = trigger.query.toLowerCase();
    items = all.filter((it) => it.id.includes(q) || it.label.toLowerCase().includes(q));
  } else {
    const q = trigger.query.toLowerCase();
    items = Object.values(blocks)
      .filter((b) => b.text && !b.text.startsWith("{{") && b.id !== blockId && b.text.toLowerCase().includes(q))
      .slice(0, 7);
  }
  if (items.length === 0) return null;
  return (
    <div className="rr-dropdown">
      {items.map((item) => (
        <div
          key={item.id}
          className="rr-dropdown-item"
          onMouseDown={(e) => {
            e.preventDefault();
            select(item);
          }}
        >
          {trigger.type === "page" ? (
            item.isNew ? `+ Create page "${item.title}"` : item.title
          ) : trigger.type === "slash" ? (
            <span className="rr-dropdown-slash-item">
              <span>{item.label}</span>
              <span className="rr-dropdown-sub">{item.sub}</span>
            </span>
          ) : (
            truncate(item.text, 70)
          )}
        </div>
      ))}
    </div>
  );
}

function BlockEditor({ id, asCell }) {
  const {
    draft,
    setDraft,
    trigger,
    setTrigger,
    commitEdit,
    setEditingId,
    addSiblingAfter,
    indent,
    outdent,
    removeEmptyBlock,
    ensurePage,
    extractSelectionToBlockRef,
    applyTrigger,
  } = useApp();
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const insertPosRef = useRef(0);
  const fileInputRef = useRef(null);
  const uploadingRef = useRef(false);
  const [insertOpen, setInsertOpen] = useState(null); // null | "link" | "image" | "gif"
  const [insertUrl, setInsertUrl] = useState("");
  const [insertText, setInsertText] = useState("");
  const [selToolbar, setSelToolbar] = useState(null); // null | { top, left }

  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
      autoResize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function autoResize() {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }

  function placeCaret(pos) {
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(pos, pos);
        autoResize();
      }
    });
  }

  function insertImageFile(file, pos) {
    if (!file || !file.type || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const alt = file.name ? file.name.replace(/\.[^.]+$/, "") : "image";
      const snippet = `![${alt}](${dataUrl})`;
      setDraft((d) => d.slice(0, pos) + snippet + d.slice(pos));
      placeCaret(pos + snippet.length);
    };
    reader.readAsDataURL(file);
  }

  function handlePaste(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        const pos = ref.current ? ref.current.selectionStart : draft.length;
        insertImageFile(file, pos);
        return;
      }
    }
  }

  function handleDragOver(e) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
    }
  }

  function handleDrop(e) {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const file = Array.from(files).find((f) => f.type && f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    const pos = ref.current ? ref.current.selectionStart : draft.length;
    insertImageFile(file, pos);
  }

  function handleFileSelect(e) {
    uploadingRef.current = false;
    const file = e.target.files && e.target.files[0];
    if (file) insertImageFile(file, insertPosRef.current);
    e.target.value = "";
  }

  function updateSelToolbar() {
    const ta = ref.current;
    if (!ta) return;
    if (ta.selectionStart === ta.selectionEnd) {
      setSelToolbar(null);
      return;
    }
    const coords = getCaretCoordinates(ta, ta.selectionStart);
    setSelToolbar({ top: coords.top, left: coords.left });
  }

  function wrapSelection(marker) {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const selected = draft.slice(start, end);
    const mLen = marker.length;
    const before = draft.slice(Math.max(0, start - mLen), start);
    const after = draft.slice(end, end + mLen);
    let newDraft, newStart, newEnd;
    if (before === marker && after === marker) {
      // already wrapped from outside the selection - unwrap
      newDraft = draft.slice(0, start - mLen) + selected + draft.slice(end + mLen);
      newStart = start - mLen;
      newEnd = end - mLen;
    } else if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= mLen * 2) {
      // selection itself includes the markers - unwrap
      const inner = selected.slice(mLen, selected.length - mLen);
      newDraft = draft.slice(0, start) + inner + draft.slice(end);
      newStart = start;
      newEnd = start + inner.length;
    } else {
      newDraft = draft.slice(0, start) + marker + selected + marker + draft.slice(end);
      newStart = start + mLen;
      newEnd = end + mLen;
    }
    setDraft(newDraft);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(newStart, newEnd);
        autoResize();
      }
    });
  }

  function toggleBold() {
    wrapSelection("**");
  }

  function toggleItalic() {
    wrapSelection("*");
  }

  function toggleHighlight() {
    wrapSelection("==");
  }

  function handleSuggestSelect(item) {
    if (trigger && trigger.type === "slash" && (item.id === "link" || item.id === "image" || item.id === "gif")) {
      const cursor = trigger.start + trigger.query.length;
      const newDraft = draft.slice(0, trigger.start - 1) + draft.slice(cursor);
      setDraft(newDraft);
      insertPosRef.current = trigger.start - 1;
      setTrigger(null);
      setInsertUrl("");
      setInsertText("");
      setInsertOpen(item.id);
      return;
    }
    if (trigger && trigger.type === "slash" && item.id === "upload") {
      const cursor = trigger.start + trigger.query.length;
      const newDraft = draft.slice(0, trigger.start - 1) + draft.slice(cursor);
      setDraft(newDraft);
      insertPosRef.current = trigger.start - 1;
      setTrigger(null);
      uploadingRef.current = true;
      requestAnimationFrame(() => {
        if (fileInputRef.current) fileInputRef.current.click();
      });
      return;
    }
    if (trigger && trigger.type === "slash" && item.id === "encrypt") {
      const cursor = trigger.start + trigger.query.length;
      const contentToEncrypt = (draft.slice(0, trigger.start - 1) + draft.slice(cursor)).trim();
      const strippedDraft = draft.slice(0, trigger.start - 1) + draft.slice(cursor);
      setTrigger(null);
      if (!contentToEncrypt) {
        setDraft(strippedDraft);
        return;
      }
      const passphrase = window.prompt("Set a passphrase to lock this block:");
      if (!passphrase) {
        setDraft(strippedDraft);
        return;
      }
      const hint = window.prompt("Optional hint for the passphrase (leave blank for none):") || "";
      encryptBlockText(contentToEncrypt, passphrase).then((payload) => {
        const marker = ENCRYPTED_MARKER + JSON.stringify({ ...payload, hint });
        commitEdit(id, marker);
        setEditingId(null);
      });
      return;
    }
    applyTrigger(id, trigger, item);
  }

  function copySelection() {
    const ta = ref.current;
    if (!ta) return;
    const text = draft.slice(ta.selectionStart, ta.selectionEnd);
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function handleChange(e) {
    const val = e.target.value;
    if (val.trim() === "---") {
      commitEdit(id, "{{hr}}");
      addSiblingAfter(id);
      return;
    }
    setDraft(val);
    setTrigger(detectTrigger(val, e.target.selectionStart));
    autoResize();
  }

  function handleKeyDown(e) {
    if (e.altKey && e.key === "0") {
      e.preventDefault();
      setDraft((d) => stripBlockPrefix(d));
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        toggleBold();
        return;
      }
      if (k === "i") {
        e.preventDefault();
        toggleItalic();
        return;
      }
      if (k === "h") {
        e.preventDefault();
        toggleHighlight();
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (insertOpen) {
        setInsertOpen(null);
        return;
      }
      setTrigger(null);
      commitEdit(id, draft);
      setEditingId(null);
      return;
    }

    if (e.key === "Tab" && !asCell) {
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const hasSelection = start !== end;

      if (hasSelection) {
        e.preventDefault();
        const selected = draft.slice(start, end);
        const trimmed = selected.trim();
        if (!trimmed) return;
        if (e.shiftKey) {
          // Shift+Tab on a selected phrase: extract it into its own block, replace the
          // selection with a block reference pointing back at it.
          const nid = extractSelectionToBlockRef(id, trimmed);
          const newDraft = draft.slice(0, start) + `((${nid}))` + draft.slice(end);
          setDraft(newDraft);
          placeCaret(start + `((${nid}))`.length);
        } else {
          // Tab on a selected word/phrase: turn it into a [[page link]].
          ensurePage(trimmed);
          const newDraft = draft.slice(0, start) + `[[${trimmed}]]` + draft.slice(end);
          setDraft(newDraft);
          placeCaret(start + `[[${trimmed}]]`.length);
        }
        return;
      }

      // No selection: fall back to ordinary indent / outdent of the whole block.
      e.preventDefault();
      commitEdit(id, draft);
      if (e.shiftKey) outdent(id);
      else indent(id);
      return;
    }

    if (!asCell) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitEdit(id, draft);
        addSiblingAfter(id);
        return;
      }
      if (e.key === "Backspace" && draft === "") {
        e.preventDefault();
        removeEmptyBlock(id);
        return;
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(id, draft);
      setEditingId(null);
    }
  }

  function handleBlur(e) {
    const next = e.relatedTarget;
    if (uploadingRef.current || (next && wrapRef.current && wrapRef.current.contains(next))) {
      // Focus moved to the insert toolbar/popover, or a native file picker is open - don't close.
      return;
    }
    setSelToolbar(null);
    commitEdit(id, draft);
    setEditingId(null);
    setTrigger(null);
  }

  function confirmInsert() {
    const url = insertUrl.trim();
    if (!url) {
      setInsertOpen(null);
      return;
    }
    const snippet =
      insertOpen === "link" ? `[${insertText.trim() || url}](${url})` : `![${insertText.trim()}](${url})`;
    const pos = insertPosRef.current;
    const newDraft = draft.slice(0, pos) + snippet + draft.slice(pos);
    setDraft(newDraft);
    setInsertOpen(null);
    placeCaret(pos + snippet.length);
  }

  return (
    <div className="rr-editor-wrap" ref={wrapRef}>
      <textarea
        ref={ref}
        className={asCell ? "rr-editor rr-editor-cell" : "rr-editor"}
        value={draft}
        rows={1}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSelect={updateSelToolbar}
        onMouseUp={updateSelToolbar}
        onKeyUp={updateSelToolbar}
      />
      {selToolbar && (
        <div
          className="rr-sel-toolbar"
          style={{ top: selToolbar.top - 8, left: selToolbar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" onClick={toggleBold} title="Bold (Cmd+B)">
            <Bold size={12} />
          </button>
          <button type="button" onClick={toggleItalic} title="Italic (Cmd+I)">
            <Italic size={12} />
          </button>
          <button type="button" onClick={toggleHighlight} title="Highlight (Cmd+H)">
            <Highlighter size={12} />
          </button>
          <button type="button" onClick={copySelection} title="Copy">
            <CopyIcon size={12} />
          </button>
        </div>
      )}
      {trigger && <SuggestDropdown blockId={id} trigger={trigger} onSelect={handleSuggestSelect} />}
      {!asCell && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileSelect}
          onCancel={() => {
            uploadingRef.current = false;
          }}
        />
      )}
      {!asCell &&
        (() => {
          const previews = extractImageRefs(draft);
          if (previews.length === 0) return null;
          return (
            <div className="rr-insert-preview-strip">
              {previews.map((img, i) => (
                <img
                  key={i}
                  src={img.url}
                  alt={img.alt || "image"}
                  className="rr-insert-preview-thumb"
                  title={img.alt || "image"}
                />
              ))}
            </div>
          );
        })()}
      {insertOpen && (
        <div className="rr-insert-popover">
          {insertOpen === "link" && (
            <input
              className="rr-insert-input"
              placeholder="Link text (optional)"
              value={insertText}
              onChange={(e) => setInsertText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmInsert();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setInsertOpen(null);
                }
              }}
            />
          )}
          <input
            className="rr-insert-input"
            autoFocus
            placeholder={insertOpen === "link" ? "https://..." : insertOpen === "gif" ? "GIF URL" : "Image URL"}
            value={insertUrl}
            onChange={(e) => setInsertUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmInsert();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setInsertOpen(null);
              }
            }}
          />
          <button type="button" className="rr-insert-add" onClick={confirmInsert}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Block row (recursive bullet tree)                                       */
/* ---------------------------------------------------------------------- */

function BlockRow({ id, depth, forceViewMode, index }) {
  const {
    blocks,
    editingId,
    startEditing,
    collapsed,
    toggleCollapse,
    goToPageTitle,
    goToBlockRef,
    setRefPanel,
    addSiblingBefore,
    onImageResize,
    viewModeBlocks,
    draggingId,
    setDraggingId,
    moveBlock,
    commitEdit,
  } = useApp();
  const block = blocks[id];
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOverPos, setDragOverPos] = useState(null); // "above" | "below" | null

  if (!block) return null;

  if (block.text.trim() === "{{table}}") {
    return <TableBlock id={id} depth={depth} />;
  }

  if (block.text.trim() === "{{hr}}") {
    return <HrBlock id={id} depth={depth} />;
  }

  if (block.text.trim() === "{{pomodoro}}") {
    return <PomodoroBlock id={id} depth={depth} />;
  }

  if (block.text.startsWith(ENCRYPTED_MARKER)) {
    return <EncryptedBlock id={id} depth={depth} raw={block.text} />;
  }

  const isEditing = editingId === id;
  const hasChildren = block.children.length > 0;
  const isCollapsed = collapsed.has(id);
  const refCount = countRefs(blocks, id);
  const ownMode = viewModeBlocks.get(id);
  const effectiveMode = ownMode || forceViewMode || "bullet";
  const isDocView = effectiveMode === "document";
  const isNumbered = effectiveMode === "numbered";
  const isDragging = draggingId === id;

  function handleDragOver(e) {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDragOverPos(e.clientY - rect.top < rect.height / 2 ? "above" : "below");
  }

  function handleDrop(e) {
    if (!draggingId) return;
    e.preventDefault();
    if (draggingId !== id) {
      moveBlock(draggingId, id, dragOverPos === "above" ? "before" : "after");
    }
    setDragOverPos(null);
    setDraggingId(null);
  }

  return (
    <div className={"rr-block" + (isDocView ? " rr-docview" : "")}>
      {!isDocView && (
        <button
          className="rr-add-above"
          style={{ left: depth * 22 + 2 }}
          onClick={() => addSiblingBefore(id)}
          title="Add block above"
        >
          <Plus size={11} />
        </button>
      )}
      <div
        className={
          "rr-row" +
          (isDragging ? " rr-row-dragging" : "") +
          (dragOverPos ? " rr-row-dragover-" + dragOverPos : "")
        }
        style={{ paddingLeft: isDocView ? 0 : depth * 22 }}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOverPos(null)}
        onDrop={handleDrop}
      >
        {!isDocView && (
          <span
            className="rr-drag-handle"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDraggingId(id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverPos(null);
            }}
            title="Drag to reorder"
          >
            <GripVertical size={12} />
          </span>
        )}
        {!isDocView &&
          (hasChildren ? (
            <button className="rr-collapse" onClick={() => toggleCollapse(id)}>
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="rr-collapse-spacer" />
          ))}
        <span className={"rr-bullet-wrap" + (isDocView ? " rr-bullet-wrap-docview" : "")}>
          {isNumbered ? (
            <button className="rr-bullet-number" onClick={() => setMenuOpen((o) => !o)} title="Block options">
              {(index || 1) + "."}
            </button>
          ) : (
            <Bullet filled={hasChildren} onClick={() => setMenuOpen((o) => !o)} />
          )}
          {menuOpen && <BulletMenu id={id} onClose={() => setMenuOpen(false)} />}
        </span>
        <div className="rr-content">
          {isEditing ? (
            <BlockEditor id={id} />
          ) : (
            <div className="rr-text" onClick={() => startEditing(id)}>
              {block.text ? (
                (() => {
                  const todo = parseTodo(block.text);
                  if (todo.isTodo) {
                    return (
                      <span className="rr-todo-line">
                        <input
                          type="checkbox"
                          className="rr-todo-checkbox"
                          checked={todo.checked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => commitEdit(id, (todo.checked ? "[ ] " : "[x] ") + todo.rest)}
                        />
                        <span className={"rr-todo-text" + (todo.checked ? " rr-todo-checked" : "")}>
                          {todo.rest ? (
                            renderInline(todo.rest, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: id, onImageResize })
                          ) : (
                            <span className="rr-empty">Empty todo</span>
                          )}
                        </span>
                      </span>
                    );
                  }
                  const header = parseHeader(block.text);
                  if (header.isHeader) {
                    return (
                      <span className="rr-heading">
                        {renderInline(header.rest, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: id, onImageResize })}
                      </span>
                    );
                  }
                  const quote = parseQuote(block.text);
                  if (quote.isQuote) {
                    return (
                      <span className="rr-quote">
                        {renderInline(quote.rest, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: id, onImageResize })}
                      </span>
                    );
                  }
                  return renderInline(block.text, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: id, onImageResize });
                })()
              ) : (
                <span className="rr-empty">Empty block—click to write</span>
              )}
            </div>
          )}
        </div>
        {refCount > 0 && (
          <button className="rr-refcount" onClick={() => setRefPanel(id)} title="See linked references">
            {refCount}
          </button>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div className="rr-children">
          {block.children.map((cid, idx) => (
            <BlockRow
              key={cid}
              id={cid}
              depth={depth + 1}
              index={idx + 1}
              forceViewMode={effectiveMode !== "bullet" ? effectiveMode : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Divider block (from "---" or the /Divider slash command)                */
/* ---------------------------------------------------------------------- */

function HrBlock({ id, depth }) {
  const { deleteLeafBlock } = useApp();
  return (
    <div className="rr-hr-wrap" style={{ marginLeft: depth * 22 }}>
      <hr className="rr-hr" />
      <button className="rr-hr-delete" onClick={() => deleteLeafBlock(id)} title="Remove divider">
        <X size={12} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Pomodoro timer block (from the /Time or /Pomodoro slash command)        */
/* ---------------------------------------------------------------------- */

const POMODORO_WORK = 25 * 60;
const POMODORO_BREAK = 5 * 60;

function PomodoroBlock({ id, depth }) {
  const { deleteLeafBlock } = useApp();
  const [mode, setMode] = useState("work");
  const [seconds, setSeconds] = useState(POMODORO_WORK);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          setRunning(false);
          setMode((m) => {
            const next = m === "work" ? "break" : "work";
            setSeconds(next === "work" ? POMODORO_WORK : POMODORO_BREAK);
            return next;
          });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  function switchMode(next) {
    setRunning(false);
    setMode(next);
    setSeconds(next === "work" ? POMODORO_WORK : POMODORO_BREAK);
  }

  function reset() {
    setRunning(false);
    setSeconds(mode === "work" ? POMODORO_WORK : POMODORO_BREAK);
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="rr-pomodoro-wrap" style={{ marginLeft: depth * 22 }}>
      <div className={"rr-pomodoro" + (mode === "break" ? " rr-pomodoro-break" : "")}>
        <div className="rr-pomodoro-tabs">
          <button
            className={"rr-pomodoro-tab" + (mode === "work" ? " rr-pomodoro-tab-active" : "")}
            onClick={() => switchMode("work")}
          >
            Focus
          </button>
          <button
            className={"rr-pomodoro-tab" + (mode === "break" ? " rr-pomodoro-tab-active" : "")}
            onClick={() => switchMode("break")}
          >
            Break
          </button>
        </div>
        <div className="rr-pomodoro-time">
          {mm}:{ss}
        </div>
        <div className="rr-pomodoro-controls">
          <button className="rr-pomodoro-btn" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Start"}
          </button>
          <button className="rr-pomodoro-btn rr-pomodoro-btn-ghost" onClick={reset}>
            Reset
          </button>
        </div>
      </div>
      <button className="rr-hr-delete rr-pomodoro-delete" onClick={() => deleteLeafBlock(id)} title="Remove timer">
        <X size={12} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Encrypted block (from the /Encrypt slash command)                       */
/* ---------------------------------------------------------------------- */

function EncryptedBlock({ id, depth, raw }) {
  const { deleteLeafBlock } = useApp();
  const [pass, setPass] = useState("");
  const [revealed, setRevealed] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  let payload = null;
  try {
    payload = JSON.parse(raw.slice(ENCRYPTED_MARKER.length));
  } catch (e) {
    payload = null;
  }

  async function unlock() {
    if (!payload || !pass) return;
    setBusy(true);
    setError("");
    try {
      const text = await decryptBlockText(payload, pass);
      setRevealed(text);
      setPass("");
    } catch (e) {
      setError("Wrong passphrase.");
    }
    setBusy(false);
  }

  if (!payload) {
    return (
      <div className="rr-encrypted-wrap" style={{ marginLeft: depth * 22 }}>
        <div className="rr-encrypted">Couldn't read this encrypted block.</div>
      </div>
    );
  }

  return (
    <div className="rr-encrypted-wrap" style={{ marginLeft: depth * 22 }}>
      <div className="rr-encrypted">
        {revealed !== null ? (
          <>
            <div className="rr-encrypted-revealed">{revealed}</div>
            <button className="rr-encrypted-lock" onClick={() => setRevealed(null)}>
              <Lock size={12} /> Lock again
            </button>
          </>
        ) : (
          <>
            <div className="rr-encrypted-head">
              <Lock size={13} /> Encrypted block
            </div>
            {payload.hint && <div className="rr-encrypted-hint">Hint: {payload.hint}</div>}
            <div className="rr-encrypted-form">
              <input
                type="password"
                className="rr-encrypted-input"
                placeholder="Passphrase"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") unlock();
                }}
              />
              <button className="rr-encrypted-unlock" onClick={unlock} disabled={busy || !pass}>
                {busy ? "…" : "Unlock"}
              </button>
            </div>
            {error && <div className="rr-encrypted-error">{error}</div>}
          </>
        )}
      </div>
      <button className="rr-hr-delete rr-encrypted-delete" onClick={() => deleteLeafBlock(id)} title="Remove encrypted block">
        <X size={12} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Table block (simplified layout table, no databases)                     */
/* ---------------------------------------------------------------------- */

function TableBlock({ id, depth }) {
  const { blocks } = useApp();
  const block = blocks[id];
  return (
    <div className="rr-table-wrap" style={{ marginLeft: depth * 22 }}>
      <table className="rr-table">
        <tbody>
          {block.children.map((rowId) => {
            const row = blocks[rowId];
            if (!row) return null;
            return (
              <tr key={rowId}>
                {row.children.map((cellId) => (
                  <TableCell key={cellId} id={cellId} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableCell({ id }) {
  const { blocks, editingId, startEditing, goToPageTitle, goToBlockRef, onImageResize } = useApp();
  const block = blocks[id];
  const isEditing = editingId === id;
  return (
    <td className="rr-td" onClick={() => !isEditing && startEditing(id)}>
      {isEditing ? (
        <BlockEditor id={id} asCell />
      ) : (
        <span>{block.text ? renderInline(block.text, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: id, onImageResize }) : <span className="rr-empty">—</span>}</span>
      )}
    </td>
  );
}

/* ---------------------------------------------------------------------- */
/* Breadcrumb                                                              */
/* ---------------------------------------------------------------------- */

function Breadcrumb({ pageId }) {
  const { pages, blocks, focusedBlockId, setFocusedBlockId } = useApp();
  const page = pages[pageId];
  if (!page) return null;
  const chain = [];
  let cur = focusedBlockId;
  while (cur) {
    chain.unshift(cur);
    const b = blocks[cur];
    if (!b || !b.parentId || b.parentId === page.rootBlockId) break;
    cur = b.parentId;
  }
  return (
    <div className="rr-breadcrumb">
      <span className="rr-crumb" onClick={() => setFocusedBlockId(null)}>
        {page.title}
      </span>
      {chain.map((id) => (
        <React.Fragment key={id}>
          <span className="rr-crumb-sep">›</span>
          <span className="rr-crumb" onClick={() => setFocusedBlockId(id)}>
            {truncate((blocks[id] && blocks[id].text) || "", 36)}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Linked references (page-level backlinks - the core of the "web")       */
/* ---------------------------------------------------------------------- */

function LinkedRefs({ pageId }) {
  const { pages, blocks, goToPageTitle, goToBlockRef, onImageResize } = useApp();
  const refs = pageBacklinks(blocks, pageId);
  if (refs.length === 0) return null;

  const grouped = {};
  refs.forEach((b) => {
    if (!grouped[b.pageId]) grouped[b.pageId] = [];
    grouped[b.pageId].push(b);
  });

  return (
    <div className="rr-linked">
      <h3>Linked References ({refs.length})</h3>
      {Object.keys(grouped).map((srcPageId) => (
        <div key={srcPageId} className="rr-linked-group">
          <div
            className="rr-linked-group-title"
            onClick={() => pages[srcPageId] && goToPageTitle(pages[srcPageId].title, false)}
          >
            <FileText size={12} /> {pages[srcPageId] ? pages[srcPageId].title : "?"}
          </div>
          {grouped[srcPageId].map((b) => (
            <div key={b.id} className="rr-linked-item" onClick={() => goToBlockRef(b.id, false)}>
              {renderInline(b.text, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: b.id, onImageResize })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Unlinked references                                                     */
/* ---------------------------------------------------------------------- */

function UnlinkedRefs({ pageId }) {
  const { pages, blocks, linkOccurrence, goToPageTitle, goToBlockRef, onImageResize } = useApp();
  const page = pages[pageId];
  if (!page) return null;
  const title = page.title;
  const lower = title.toLowerCase();
  const matches = Object.values(blocks).filter(
    (b) =>
      b.text &&
      !b.id.startsWith("root-") &&
      !b.text.startsWith("{{") &&
      !b.text.includes(`[[${title}]]`) &&
      b.text.toLowerCase().includes(lower)
  );
  if (matches.length === 0) return null;
  return (
    <div className="rr-unlinked">
      <h3>Unlinked References ({matches.length})</h3>
      {matches.map((b) => (
        <div key={b.id} className="rr-unlinked-item">
          <div className="rr-unlinked-text">
            {renderInline(b.text, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: b.id, onImageResize })}
            <span className="rr-unlinked-page"> — in {pages[b.pageId] ? pages[b.pageId].title : "?"}</span>
          </div>
          <button className="rr-link-btn" onClick={() => linkOccurrence(b.id, title)}>
            <Link2 size={12} /> Link
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Page view                                                               */
/* ---------------------------------------------------------------------- */

function PageView({ pageId }) {
  const { pages, blocks, focusedBlockId, addChildBlock } = useApp();
  const page = pages[pageId];
  if (!page) return <div className="rr-empty-page">Page not found.</div>;
  const rootId = focusedBlockId || page.rootBlockId;
  const rootBlock = blocks[rootId];
  if (!rootBlock) return null;
  const title = focusedBlockId ? blocks[focusedBlockId].text || "Untitled block" : page.title;

  const backlinkCount = !focusedBlockId ? pageBacklinks(blocks, pageId).length : 0;
  const unlinkedCount =
    !focusedBlockId && !page.isDaily
      ? Object.values(blocks).filter(
          (b) =>
            b.text &&
            !b.id.startsWith("root-") &&
            !b.text.startsWith("{{") &&
            !b.text.includes(`[[${page.title}]]`) &&
            b.text.toLowerCase().includes(page.title.toLowerCase())
        ).length
      : 0;
  const isOrphan = !focusedBlockId && !page.isDaily && backlinkCount === 0 && unlinkedCount === 0;

  return (
    <div className="rr-page">
      <Breadcrumb pageId={pageId} />
      <h1 className="rr-title">{title}</h1>
      {isOrphan && (
        <div className="rr-orphan-hint">
          This page isn't connected to anything yet. Mention <span className="rr-link-preview">[[{page.title}]]</span> from another note
          to weave it into the web.
        </div>
      )}
      <div className="rr-blocklist">
        {rootBlock.children.length === 0 && <div className="rr-empty-page">Nothing here yet.</div>}
        {rootBlock.children.map((cid, idx) => (
          <BlockRow key={cid} id={cid} depth={0} index={idx + 1} />
        ))}
        <button className="rr-add-block" onClick={() => addChildBlock(rootId)}>
          <Plus size={13} /> add block
        </button>
      </div>
      {!focusedBlockId && (
        <>
          <LinkedRefs pageId={pageId} />
          <UnlinkedRefs pageId={pageId} />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Graph overview                                                          */
/* ---------------------------------------------------------------------- */

function GraphView() {
  const { pages, blocks, setCurrentPageId, setFocusedBlockId, setView } = useApp();
  const [positions, setPositions] = useState({});
  const pageIds = useMemo(() => Object.keys(pages), [pages]);

  const edges = useMemo(() => {
    const seen = new Set();
    const list = [];
    Object.values(blocks).forEach((b) => {
      if (!b.text) return;
      extractPageLinks(b.text).forEach((title) => {
        const targetId = "p-" + slugify(title);
        if (pages[targetId] && targetId !== b.pageId) {
          const key = [b.pageId, targetId].sort().join("|");
          if (!seen.has(key)) {
            seen.add(key);
            list.push([b.pageId, targetId]);
          }
        }
      });
    });
    return list;
  }, [blocks, pages]);

  useEffect(() => {
    const w = 800,
      h = 480;
    let pos = {};
    pageIds.forEach((id, i) => {
      const angle = i * 2.399963;
      const r = Math.min(180, 30 + i * 16);
      pos[id] = { x: w / 2 + r * Math.cos(angle), y: h / 2 + r * Math.sin(angle) };
    });
    for (let iter = 0; iter < 140; iter++) {
      const forces = {};
      pageIds.forEach((id) => (forces[id] = { x: 0, y: 0 }));
      for (let i = 0; i < pageIds.length; i++) {
        for (let j = i + 1; j < pageIds.length; j++) {
          const a = pageIds[i],
            b = pageIds[j];
          const dx = pos[a].x - pos[b].x,
            dy = pos[a].y - pos[b].y;
          const d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const force = 2400 / d2;
          forces[a].x += (dx / d) * force;
          forces[a].y += (dy / d) * force;
          forces[b].x -= (dx / d) * force;
          forces[b].y -= (dy / d) * force;
        }
      }
      edges.forEach(([a, b]) => {
        if (!pos[a] || !pos[b]) return;
        const dx = pos[b].x - pos[a].x,
          dy = pos[b].y - pos[a].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = d * 0.02;
        forces[a].x += (dx / d) * force;
        forces[a].y += (dy / d) * force;
        forces[b].x -= (dx / d) * force;
        forces[b].y -= (dy / d) * force;
      });
      pageIds.forEach((id) => {
        pos[id] = {
          x: Math.max(36, Math.min(w - 36, pos[id].x + forces[id].x * 0.05)),
          y: Math.max(36, Math.min(h - 36, pos[id].y + forces[id].y * 0.05)),
        };
      });
    }
    setPositions(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIds.join(","), edges.length]);

  return (
    <div className="rr-graph">
      <h1 className="rr-title">Graph Overview</h1>
      <p className="rr-graph-sub">{pageIds.length} pages · {edges.length} links</p>
      <svg viewBox="0 0 800 480" className="rr-graph-svg">
        {edges.map(([a, b], i) =>
          positions[a] && positions[b] ? (
            <line key={i} x1={positions[a].x} y1={positions[a].y} x2={positions[b].x} y2={positions[b].y} className="rr-edge" />
          ) : null
        )}
        {pageIds.map((id) =>
          positions[id] ? (
            <g
              key={id}
              transform={`translate(${positions[id].x},${positions[id].y})`}
              className="rr-node"
              onClick={() => {
                setCurrentPageId(id);
                setFocusedBlockId(null);
                setView("page");
              }}
            >
              <circle r={10} />
              <text x="14" y="4">
                {pages[id].title}
              </text>
            </g>
          ) : null
        )}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* All pages view                                                          */
/* ---------------------------------------------------------------------- */

function AllPagesView() {
  const { pages, blocks, setCurrentPageId, setView, setFocusedBlockId, setDeleteConfirmId, toggleStarPage } = useApp();
  const countBlocks = (page) => {
    let n = 0;
    const walk = (id) => {
      const b = blocks[id];
      if (!b) return;
      if (id !== page.rootBlockId) n++;
      b.children.forEach(walk);
    };
    walk(page.rootBlockId);
    return n;
  };
  const list = Object.values(pages).sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="rr-page">
      <h1 className="rr-title">All Pages</h1>
      <p className="rr-graph-sub">Star a page to pin it under Shortcuts in the sidebar.</p>
      <div className="rr-allpages">
        {list.map((p) => (
          <div
            key={p.id}
            className="rr-allpages-item"
            onClick={() => {
              setCurrentPageId(p.id);
              setFocusedBlockId(null);
              setView("page");
            }}
          >
            <button
              className={"rr-star-btn" + (p.starred ? " rr-star-btn-active" : "")}
              title={p.starred ? "Remove from Shortcuts" : "Add to Shortcuts"}
              onClick={(e) => {
                e.stopPropagation();
                toggleStarPage(p.id);
              }}
            >
              <Star size={14} fill={p.starred ? "currentColor" : "none"} />
            </button>
            {p.isDaily ? <Calendar size={14} /> : <FileText size={14} />}
            <span className="rr-allpages-title">{p.title}</span>
            <span className="rr-allpages-count">{countBlocks(p)} blocks</span>
            <button
              className="rr-allpages-delete"
              title="Delete page"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteConfirmId(p.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Right sidebar (multi-pane, shift-click)                                 */
/* ---------------------------------------------------------------------- */

function SidebarPanel({ panel }) {
  const { pages, blocks, closeSidebarPanel } = useApp();
  const isPage = panel.kind === "page";
  const rootBlock = isPage ? blocks[pages[panel.id] ? pages[panel.id].rootBlockId : ""] : null;
  const title = isPage ? (pages[panel.id] ? pages[panel.id].title : "Untitled") : truncate((blocks[panel.id] && blocks[panel.id].text) || "", 60);

  return (
    <div className="rr-sidepanel">
      <div className="rr-sidepanel-head">
        <strong>{title}</strong>
        <button className="rr-sidepanel-close" onClick={() => closeSidebarPanel(panel.id)}>
          <X size={14} />
        </button>
      </div>
      <div className="rr-sidepanel-body">
        {isPage
          ? rootBlock &&
            (rootBlock.children.length === 0 ? (
              <div className="rr-empty-page">Nothing here yet.</div>
            ) : (
              rootBlock.children.map((cid, idx) => <BlockRow key={cid} id={cid} depth={0} index={idx + 1} />)
            ))
          : blocks[panel.id] && <BlockRow id={panel.id} depth={0} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Linked-reference modal (block ref counter)                              */
/* ---------------------------------------------------------------------- */

function RefPanelModal({ blockId, onClose }) {
  const { blocks, pages, setCurrentPageId, setFocusedBlockId, setView, goToPageTitle, goToBlockRef, onImageResize } = useApp();
  const target = blocks[blockId];
  const refs = Object.values(blocks).filter((b) => b.text && b.text.includes(`((${blockId}))`));
  return (
    <div className="rr-modal-backdrop" onClick={onClose}>
      <div className="rr-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Linked References ({refs.length})</h3>
        {target && <div className="rr-ref-source">Referenced block: {truncate(target.text, 90)}</div>}
        <div className="rr-ref-list">
          {refs.map((b) => (
            <div
              key={b.id}
              className="rr-ref-item"
              onClick={() => {
                setCurrentPageId(b.pageId);
                setFocusedBlockId(b.id);
                setView("page");
                onClose();
              }}
            >
              <div className="rr-ref-page">{pages[b.pageId] ? pages[b.pageId].title : "?"}</div>
              <div>{renderInline(b.text, { blocks, onPage: goToPageTitle, onBlockRef: goToBlockRef, blockId: b.id, onImageResize })}</div>
            </div>
          ))}
        </div>
        <button className="rr-modal-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Delete page confirmation                                                */
/* ---------------------------------------------------------------------- */

function DeletePageConfirm({ pageId, onClose }) {
  const { pages, deletePage } = useApp();
  const page = pages[pageId];
  if (!page) {
    return null;
  }
  return (
    <div className="rr-modal-backdrop" onClick={onClose}>
      <div className="rr-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Delete "{page.title}"?</h3>
        <p className="rr-modal-sub">
          This permanently removes the page and every block on it. Any [[link]] to it elsewhere will just recreate an empty page if clicked again.
        </p>
        <div className="rr-modal-actions">
          <button className="rr-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rr-btn-danger"
            onClick={() => {
              deletePage(pageId);
              onClose();
            }}
          >
            <Trash2 size={13} /> Delete page
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Quick capture                                                           */
/* ---------------------------------------------------------------------- */

function QuickCapture() {
  const { quickCaptureOpen, setQuickCaptureOpen, ensureDailyPage, setBlocks } = useApp();
  const [text, setText] = useState("");
  if (!quickCaptureOpen) return null;

  function submit() {
    if (!text.trim()) {
      setQuickCaptureOpen(false);
      return;
    }
    const pageId = ensureDailyPage();
    const nid = genId();
    const finalText = text.includes("#Quick Capture") ? text : text + " #Quick Capture";
    setBlocks((prev) => {
      const rootId = "root-" + pageId;
      const root = prev[rootId];
      if (!root) return prev;
      return {
        ...prev,
        [nid]: { id: nid, pageId, parentId: rootId, text: finalText, children: [], createdAt: Date.now() },
        [rootId]: { ...root, children: [...root.children, nid] },
      };
    });
    setText("");
    setQuickCaptureOpen(false);
  }

  return (
    <div className="rr-modal-backdrop" onClick={() => setQuickCaptureOpen(false)}>
      <div className="rr-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Quick Capture</h3>
        <p className="rr-modal-sub">Saved to today's Daily Note, tagged #Quick Capture.</p>
        <textarea
          autoFocus
          className="rr-quickcapture-input"
          value={text}
          placeholder="Jot something down..."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="rr-modal-actions">
          <button className="rr-btn-ghost" onClick={() => setQuickCaptureOpen(false)}>
            Cancel
          </button>
          <button className="rr-btn-primary" onClick={submit}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sidebar nav + top bar                                                   */
/* ---------------------------------------------------------------------- */

function DatePickerPopup({ onSelect, style }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayKey();

  function dateKeyFor(d) {
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="rr-datepicker" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="rr-datepicker-head">
        <button onClick={() => setViewDate(new Date(year, month - 1, 1))} title="Previous month">
          <ChevronLeft size={14} />
        </button>
        <span>{viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
        <button onClick={() => setViewDate(new Date(year, month + 1, 1))} title="Next month">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="rr-datepicker-weekdays">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="rr-datepicker-grid">
        {cells.map((d, i) =>
          d === null ? (
            <span key={i} className="rr-datepicker-empty" />
          ) : (
            <button
              key={i}
              className={"rr-datepicker-day" + (dateKeyFor(d) === todayStr ? " rr-datepicker-today" : "")}
              onClick={() => onSelect(dateKeyFor(d))}
            >
              {d}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function SidebarNav() {
  const {
    pages,
    currentPageId,
    view,
    setCurrentPageId,
    setView,
    setFocusedBlockId,
    ensureDailyPage,
    ensureDailyPageForDate,
    setNavOpen,
  } = useApp();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dpPos, setDpPos] = useState({ top: 0, left: 0 });
  const dpWrapRef = useRef(null);
  const calBtnRef = useRef(null);
  const list = Object.values(pages)
    .filter((p) => !p.isDaily && p.starred)
    .sort((a, b) => a.title.localeCompare(b.title));

  useEffect(() => {
    function onDocClick(e) {
      if (dpWrapRef.current && !dpWrapRef.current.contains(e.target)) setDatePickerOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function toggleDatePicker() {
    if (!datePickerOpen && calBtnRef.current) {
      const rect = calBtnRef.current.getBoundingClientRect();
      setDpPos({ top: rect.top, left: rect.right + 8 });
    }
    setDatePickerOpen((o) => !o);
  }

  function goToDate(dateStr) {
    const id = ensureDailyPageForDate(dateStr);
    setCurrentPageId(id);
    setFocusedBlockId(null);
    setView("page");
    setDatePickerOpen(false);
  }

  return (
    <div className="rr-sidebar">
      <div className="rr-sidebar-top">
        <button className="rr-icon-btn-dark" onClick={() => setNavOpen(false)} title="Collapse sidebar">
          <Menu size={16} />
        </button>
      </div>

      <div className="rr-navrow" ref={dpWrapRef}>
        <button
          className={"rr-navitem rr-navitem-grow" + (view === "page" && pages[currentPageId] && pages[currentPageId].isDaily ? " rr-navitem-active" : "")}
          onClick={() => {
            const id = ensureDailyPage();
            setCurrentPageId(id);
            setFocusedBlockId(null);
            setView("page");
          }}
        >
          Daily Notes
        </button>
        <button ref={calBtnRef} className="rr-navitem-calendar-btn" onClick={toggleDatePicker} title="Jump to a date">
          <CalendarDays size={13} />
        </button>
        {datePickerOpen && <DatePickerPopup onSelect={goToDate} style={{ top: dpPos.top, left: dpPos.left }} />}
      </div>

      <button className={"rr-navitem" + (view === "graph" ? " rr-navitem-active" : "")} onClick={() => setView("graph")}>
        Graph Overview
      </button>
      <button className={"rr-navitem" + (view === "all" ? " rr-navitem-active" : "")} onClick={() => setView("all")}>
        All Pages
      </button>

      <div className="rr-navdivider" />

      <div className="rr-navheader">
        <Star size={11} /> Shortcuts
      </div>
      <div className="rr-navlist">
        {list.map((p) => (
          <button
            key={p.id}
            className={"rr-navitem rr-navitem-page" + (view === "page" && currentPageId === p.id ? " rr-navitem-active" : "")}
            onClick={() => {
              setCurrentPageId(p.id);
              setFocusedBlockId(null);
              setView("page");
            }}
          >
            {p.title}
          </button>
        ))}
        {list.length === 0 && <div className="rr-navempty">Star a page in All Pages to pin it here.</div>}
      </div>
    </div>
  );
}

function TopSearch() {
  const { pages, goToPageTitle } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const matches = query.trim() ? Object.values(pages).filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];
  const exactMatch = matches.some((p) => p.title.toLowerCase() === query.trim().toLowerCase());

  function selectPage(title) {
    goToPageTitle(title, false);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      const exact = matches.find((p) => p.title.toLowerCase() === query.trim().toLowerCase());
      selectPage(exact ? exact.title : query.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="rr-topsearch" ref={wrapRef}>
      <Search size={13} />
      <input
        placeholder="Find or Create Page"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && query.trim() && (
        <div className="rr-topsearch-dropdown">
          {matches.map((p) => (
            <div
              key={p.id}
              className="rr-dropdown-item"
              onMouseDown={(e) => {
                e.preventDefault();
                selectPage(p.title);
              }}
            >
              {p.title}
            </div>
          ))}
          {!exactMatch && (
            <div
              className="rr-dropdown-item rr-dropdown-item-new"
              onMouseDown={(e) => {
                e.preventDefault();
                selectPage(query.trim());
              }}
            >
              + Create page "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageMenu({ pageId }) {
  const { setDeleteConfirmId } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="rr-pagemenu-wrap" ref={wrapRef}>
      <button className="rr-icon-btn" onClick={() => setOpen((o) => !o)} title="Page menu">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="rr-pagemenu-dropdown">
          <button
            className="rr-pagemenu-item rr-pagemenu-item-danger"
            onClick={() => {
              setOpen(false);
              setDeleteConfirmId(pageId);
            }}
          >
            <Trash2 size={13} /> Delete page
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { navOpen, setNavOpen, setQuickCaptureOpen, saving, view, currentPageId, pages, toggleStarPage } = useApp();
  const currentPage = view === "page" ? pages[currentPageId] : null;
  return (
    <div className="rr-topbar">
      {!navOpen && (
        <button className="rr-icon-btn" onClick={() => setNavOpen(true)} title="Show sidebar">
          <Menu size={16} />
        </button>
      )}
      <div className="rr-topbar-spacer" />
      <span className={"rr-savedot" + (saving ? " rr-savedot-saving" : "")} title={saving ? "Saving…" : "Saved"} />
      <TopSearch />
      {currentPage && (
        <button
          className={"rr-icon-btn" + (currentPage.starred ? " rr-icon-btn-starred" : "")}
          onClick={() => toggleStarPage(currentPage.id)}
          title={currentPage.starred ? "Remove from Shortcuts" : "Add to Shortcuts"}
        >
          <Star size={16} fill={currentPage.starred ? "currentColor" : "none"} />
        </button>
      )}
      <button className="rr-icon-btn" onClick={() => setQuickCaptureOpen(true)} title="Quick capture">
        <Zap size={16} />
      </button>
      {currentPage && <PageMenu pageId={currentPage.id} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App root                                                                */
/* ---------------------------------------------------------------------- */

export default function App() {
  const [pages, setPages] = useState({});
  const [blocks, setBlocks] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [currentPageId, setCurrentPageId] = useState("p-how-to-work-from-home-effectively");
  const [view, setView] = useState("page");
  const [focusedBlockId, setFocusedBlockId] = useState(null);
  const [sidebarPanels, setSidebarPanels] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [viewModeBlocks, setViewModeBlocks] = useState(() => new Map()); // id -> "document" | "numbered"
  const [draggingId, setDraggingId] = useState(null);
  const [trigger, setTrigger] = useState(null);
  const [refPanel, setRefPanel] = useState(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rightbarWidth, setRightbarWidth] = useState(520);
  const resizingRef = useRef(false);
  const saveTimer = useRef(null);

  function startRightbarResize(e) {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = rightbarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    function onMove(ev) {
      if (!resizingRef.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(900, startWidth + delta));
      setRightbarWidth(newWidth);
    }
    function onUp() {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get("synapse-data", false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (!cancelled) {
            setPages(parsed.pages || {});
            setBlocks(parsed.blocks || {});
          }
        } else {
          const seed = seedData();
          if (!cancelled) {
            setPages(seed.pages);
            setBlocks(seed.blocks);
          }
        }
      } catch (e) {
        const seed = seedData();
        if (!cancelled) {
          setPages(seed.pages);
          setBlocks(seed.blocks);
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const id = ensureDailyPage();
    setCurrentPageId(id);
    setFocusedBlockId(null);
    setView("page");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.storage
        .set("synapse-data", JSON.stringify({ pages, blocks }), false)
        .catch(() => {})
        .finally(() => setSaving(false));
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [pages, blocks, loaded]);

  /* ---- mutation helpers ---- */

  function updateBlock(id, patch) {
    setBlocks((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  }

  function onImageResize(blockId, oldSnippet, newSnippet) {
    setBlocks((prev) => {
      const b = prev[blockId];
      if (!b || !b.text || !b.text.includes(oldSnippet)) return prev;
      const newText = b.text.replace(oldSnippet, newSnippet);
      return { ...prev, [blockId]: { ...b, text: newText } };
    });
  }

  function ensurePage(title) {
    const id = "p-" + slugify(title);
    const rootId = "root-" + id;
    setBlocks((prev) => (prev[rootId] ? prev : { ...prev, [rootId]: { id: rootId, pageId: id, parentId: null, text: "", children: [] } }));
    setPages((prev) => (prev[id] ? prev : { ...prev, [id]: { id, title, rootBlockId: rootId, isDaily: false, starred: false } }));
    return id;
  }

  function ensureDailyPageForDate(dateStr) {
    const id = "daily-" + dateStr;
    const rootId = "root-" + id;
    setBlocks((prev) => (prev[rootId] ? prev : { ...prev, [rootId]: { id: rootId, pageId: id, parentId: null, text: "", children: [] } }));
    setPages((prev) => (prev[id] ? prev : { ...prev, [id]: { id, title: formatDailyTitle(dateStr), rootBlockId: rootId, isDaily: true, starred: false } }));
    return id;
  }

  function ensureDailyPage() {
    return ensureDailyPageForDate(todayKey());
  }

  function commitEdit(id, text) {
    updateBlock(id, { text });
    extractPageLinks(text).forEach((title) => ensurePage(title));
  }

  function startEditing(id) {
    const b = blocks[id];
    setEditingId(id);
    setDraft(b ? b.text : "");
    setTrigger(null);
  }

  function addSiblingAfter(id) {
    const nid = genId();
    setBlocks((prev) => {
      const block = prev[id];
      if (!block) return prev;
      const parent = prev[block.parentId];
      if (!parent) return prev;
      const idx = parent.children.indexOf(id);
      const newChildren = [...parent.children];
      newChildren.splice(idx + 1, 0, nid);
      return {
        ...prev,
        [block.parentId]: { ...parent, children: newChildren },
        [nid]: { id: nid, pageId: block.pageId, parentId: block.parentId, text: "", children: [], createdAt: Date.now() },
      };
    });
    setEditingId(nid);
    setDraft("");
  }

  function addSiblingBefore(id) {
    const nid = genId();
    setBlocks((prev) => {
      const block = prev[id];
      if (!block) return prev;
      const parent = prev[block.parentId];
      if (!parent) return prev;
      const idx = parent.children.indexOf(id);
      const newChildren = [...parent.children];
      newChildren.splice(idx, 0, nid);
      return {
        ...prev,
        [block.parentId]: { ...parent, children: newChildren },
        [nid]: { id: nid, pageId: block.pageId, parentId: block.parentId, text: "", children: [], createdAt: Date.now() },
      };
    });
    setEditingId(nid);
    setDraft("");
  }

  function addChildBlock(parentId) {
    const nid = genId();
    setBlocks((prev) => {
      const parent = prev[parentId];
      if (!parent) return prev;
      return {
        ...prev,
        [parentId]: { ...parent, children: [...parent.children, nid] },
        [nid]: { id: nid, pageId: parent.pageId, parentId, text: "", children: [], createdAt: Date.now() },
      };
    });
    setEditingId(nid);
    setDraft("");
  }

  function indent(id) {
    setBlocks((prev) => {
      const block = prev[id];
      if (!block) return prev;
      const parent = prev[block.parentId];
      if (!parent) return prev;
      const idx = parent.children.indexOf(id);
      if (idx <= 0) return prev;
      const newParentId = parent.children[idx - 1];
      const newParent = prev[newParentId];
      const parentChildren = parent.children.filter((c) => c !== id);
      const newParentChildren = [...newParent.children, id];
      return {
        ...prev,
        [block.parentId]: { ...parent, children: parentChildren },
        [newParentId]: { ...newParent, children: newParentChildren },
        [id]: { ...block, parentId: newParentId },
      };
    });
    setEditingId(id);
  }

  function outdent(id) {
    setBlocks((prev) => {
      const block = prev[id];
      if (!block) return prev;
      const parent = prev[block.parentId];
      if (!parent || !parent.parentId) return prev;
      const grandparent = prev[parent.parentId];
      if (!grandparent) return prev;
      const parentIdxInGp = grandparent.children.indexOf(block.parentId);
      const newParentChildren = parent.children.filter((c) => c !== id);
      const newGpChildren = [...grandparent.children];
      newGpChildren.splice(parentIdxInGp + 1, 0, id);
      return {
        ...prev,
        [block.parentId]: { ...parent, children: newParentChildren },
        [parent.parentId]: { ...grandparent, children: newGpChildren },
        [id]: { ...block, parentId: parent.parentId },
      };
    });
    setEditingId(id);
  }

  function removeEmptyBlock(id) {
    let focusTarget = null;
    setBlocks((prev) => {
      const block = prev[id];
      if (!block) return prev;
      const parent = prev[block.parentId];
      if (!parent) return prev;
      if (block.children.length > 0) return prev;
      const idx = parent.children.indexOf(id);
      if (idx > 0) focusTarget = parent.children[idx - 1];
      else if (parent.parentId) focusTarget = null; // parent is a real block but we don't auto-focus it to keep things simple
      const newChildren = parent.children.filter((c) => c !== id);
      const updated = { ...prev, [block.parentId]: { ...parent, children: newChildren } };
      delete updated[id];
      return updated;
    });
    if (focusTarget) {
      setEditingId(focusTarget);
      setDraft((blocks[focusTarget] && blocks[focusTarget].text) || "");
    } else {
      setEditingId(null);
    }
  }

  function deleteLeafBlock(id) {
    setBlocks((prev) => {
      const block = prev[id];
      if (!block || block.children.length > 0) return prev;
      const parent = prev[block.parentId];
      if (!parent) return prev;
      const newChildren = parent.children.filter((c) => c !== id);
      const updated = { ...prev, [block.parentId]: { ...parent, children: newChildren } };
      delete updated[id];
      return updated;
    });
  }

  function extractSelectionToBlockRef(id, selectedText) {
    const nid = genId();
    setBlocks((prev) => {
      const block = prev[id];
      if (!block) return prev;
      const parent = prev[block.parentId];
      if (!parent) return prev;
      const idx = parent.children.indexOf(id);
      const newChildren = [...parent.children];
      newChildren.splice(idx + 1, 0, nid);
      return {
        ...prev,
        [block.parentId]: { ...parent, children: newChildren },
        [nid]: { id: nid, pageId: block.pageId, parentId: block.parentId, text: selectedText, children: [], createdAt: Date.now() },
      };
    });
    return nid;
  }

  function toggleStarPage(pageId) {
    setPages((prev) => (prev[pageId] ? { ...prev, [pageId]: { ...prev[pageId], starred: !prev[pageId].starred } } : prev));
  }

  function deletePage(pageId) {
    const deletedBlockIds = new Set(Object.values(blocks).filter((b) => b.pageId === pageId).map((b) => b.id));
    setBlocks((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((bid) => {
        if (next[bid].pageId === pageId) delete next[bid];
      });
      return next;
    });
    setPages((prev) => {
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
    setSidebarPanels((prev) => prev.filter((p) => !(p.kind === "page" && p.id === pageId) && !(p.kind === "block" && deletedBlockIds.has(p.id))));
    if (refPanel && deletedBlockIds.has(refPanel)) setRefPanel(null);
    if (editingId && deletedBlockIds.has(editingId)) setEditingId(null);
    if (currentPageId === pageId) {
      const remaining = Object.keys(pages).filter((id) => id !== pageId);
      setFocusedBlockId(null);
      if (remaining.length > 0) {
        setCurrentPageId(remaining[0]);
        setView("page");
      } else {
        setView("all");
      }
    }
  }

  function toggleCollapse(id) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function collectDescendantIds(id) {
    const out = [];
    const walk = (bid) => {
      const b = blocks[bid];
      if (!b) return;
      b.children.forEach((cid) => {
        out.push(cid);
        walk(cid);
      });
    };
    walk(id);
    return out;
  }

  function expandAll(id) {
    const ids = [id, ...collectDescendantIds(id)];
    setCollapsed((prev) => {
      const n = new Set(prev);
      ids.forEach((i) => n.delete(i));
      return n;
    });
  }

  function collapseAll(id) {
    const ids = collectDescendantIds(id).filter((i) => blocks[i] && blocks[i].children.length > 0);
    setCollapsed((prev) => {
      const n = new Set(prev);
      ids.forEach((i) => n.add(i));
      if (blocks[id] && blocks[id].children.length > 0) n.add(id);
      return n;
    });
  }

  function setViewMode(id, mode) {
    setViewModeBlocks((prev) => {
      const n = new Map(prev);
      if (mode === "bullet") n.delete(id);
      else n.set(id, mode);
      return n;
    });
  }

  function moveBlock(dragId, targetId, position) {
    if (dragId === targetId) return;
    setBlocks((prev) => {
      const dragBlock = prev[dragId];
      const targetBlock = prev[targetId];
      if (!dragBlock || !targetBlock) return prev;
      if (dragBlock.pageId !== targetBlock.pageId) return prev; // keep reordering scoped to one page
      // don't allow dropping a block onto its own descendant
      let cur = targetId;
      while (cur) {
        if (cur === dragId) return prev;
        cur = prev[cur] ? prev[cur].parentId : null;
      }
      const oldParent = prev[dragBlock.parentId];
      const newParent = prev[targetBlock.parentId];
      if (!oldParent || !newParent) return prev;

      if (oldParent.id === newParent.id) {
        const filtered = oldParent.children.filter((c) => c !== dragId);
        const idx = filtered.indexOf(targetId);
        const insertIdx = position === "before" ? idx : idx + 1;
        const newChildren = [...filtered];
        newChildren.splice(insertIdx, 0, dragId);
        return { ...prev, [oldParent.id]: { ...oldParent, children: newChildren } };
      }
      const oldChildren = oldParent.children.filter((c) => c !== dragId);
      const idx = newParent.children.indexOf(targetId);
      const insertIdx = position === "before" ? idx : idx + 1;
      const newParentChildren = [...newParent.children];
      newParentChildren.splice(insertIdx, 0, dragId);
      return {
        ...prev,
        [oldParent.id]: { ...oldParent, children: oldChildren },
        [newParent.id]: { ...newParent, children: newParentChildren },
        [dragId]: { ...dragBlock, parentId: newParent.id },
      };
    });
  }

  function applyTrigger(blockId, trig, item) {
    setDraft((d) => {
      const cursor = trig.start + trig.query.length;
      if (trig.type === "slash") {
        const beforeSlash = d.slice(0, trig.start - 1);
        const afterCursor = d.slice(cursor);
        if (item.value !== undefined) {
          return beforeSlash + item.value + afterCursor;
        }
        const rest = beforeSlash + afterCursor;
        switch (item.action) {
          case "header1":
            return "# " + stripBlockPrefix(rest);
          case "header0":
            return stripBlockPrefix(rest);
          case "quote":
            return "> " + stripBlockPrefix(rest);
          case "hr":
            return "{{hr}}";
          case "pomodoro":
            return "{{pomodoro}}";
          default:
            return rest;
        }
      }
      const insert = trig.type === "page" ? item.title + "]]" : item.id + "))";
      const before = d.slice(0, trig.start);
      const after = d.slice(cursor);
      return before + insert + after;
    });
    setTrigger(null);
  }

  function linkOccurrence(blockId, title) {
    setBlocks((prev) => {
      const b = prev[blockId];
      if (!b) return prev;
      const idx = b.text.toLowerCase().indexOf(title.toLowerCase());
      if (idx === -1) return prev;
      const original = b.text.slice(idx, idx + title.length);
      const newText = b.text.slice(0, idx) + "[[" + original + "]]" + b.text.slice(idx + title.length);
      return { ...prev, [blockId]: { ...b, text: newText } };
    });
    ensurePage(title);
  }

  function openInSidebar(kind, id) {
    setSidebarPanels((prev) => (prev.some((p) => p.id === id && p.kind === kind) ? prev : [...prev, { id, kind }]));
  }
  function closeSidebarPanel(id) {
    setSidebarPanels((prev) => prev.filter((p) => p.id !== id));
  }

  function goToPageTitle(title, shift) {
    const id = ensurePage(title);
    if (shift) {
      openInSidebar("page", id);
    } else {
      setCurrentPageId(id);
      setFocusedBlockId(null);
      setView("page");
    }
  }

  function goToBlockRef(blockId, shift) {
    if (shift) {
      openInSidebar("block", blockId);
      return;
    }
    const b = blocks[blockId];
    if (b) {
      setCurrentPageId(b.pageId);
      setFocusedBlockId(blockId);
      setView("page");
    }
  }

  const ctxValue = {
    pages,
    blocks,
    setPages,
    setBlocks,
    currentPageId,
    setCurrentPageId,
    view,
    setView,
    focusedBlockId,
    setFocusedBlockId,
    sidebarPanels,
    openInSidebar,
    closeSidebarPanel,
    editingId,
    setEditingId,
    draft,
    setDraft,
    collapsed,
    toggleCollapse,
    viewModeBlocks,
    setViewMode,
    expandAll,
    collapseAll,
    draggingId,
    setDraggingId,
    moveBlock,
    trigger,
    setTrigger,
    refPanel,
    setRefPanel,
    quickCaptureOpen,
    setQuickCaptureOpen,
    saving,
    navOpen,
    setNavOpen,
    deleteConfirmId,
    setDeleteConfirmId,
    deletePage,
    toggleStarPage,
    extractSelectionToBlockRef,
    startEditing,
    commitEdit,
    addSiblingAfter,
    addSiblingBefore,
    addChildBlock,
    indent,
    outdent,
    removeEmptyBlock,
    deleteLeafBlock,
    applyTrigger,
    linkOccurrence,
    ensurePage,
    ensureDailyPage,
    ensureDailyPageForDate,
    goToPageTitle,
    goToBlockRef,
    onImageResize,
  };

  if (!loaded) {
    return (
      <div className="rr-app rr-loading">
        <style>{CSS}</style>
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <AppCtx.Provider value={ctxValue}>
      <div className="rr-app">
        <style>{CSS}</style>
        {navOpen && <SidebarNav />}
        <div className="rr-main">
          <TopBar />
          <div className="rr-content-scroll">
            {view === "page" && <PageView pageId={currentPageId} />}
            {view === "graph" && <GraphView />}
            {view === "all" && <AllPagesView />}
          </div>
        </div>
        {sidebarPanels.length > 0 && (
          <div className="rr-rightbar" style={{ width: rightbarWidth }}>
            <div className="rr-rightbar-resizer" onMouseDown={startRightbarResize} title="Drag to resize" />
            {sidebarPanels.map((p) => (
              <SidebarPanel key={p.kind + p.id} panel={p} />
            ))}
          </div>
        )}
        <QuickCapture />
        {refPanel && <RefPanelModal blockId={refPanel} onClose={() => setRefPanel(null)} />}
        {deleteConfirmId && <DeletePageConfirm pageId={deleteConfirmId} onClose={() => setDeleteConfirmId(null)} />}
      </div>
    </AppCtx.Provider>
  );
}

/* ---------------------------------------------------------------------- */
/* Styles                                                                  */
/* ---------------------------------------------------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
html, body { height:100%; margin:0; padding:0; }
.rr-app { display:flex; height:100vh; min-height:480px; max-height:100vh; overflow:hidden; width:100%; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:#ffffff; color:#25231f; font-size:16px; }
.rr-loading { align-items:center; justify-content:center; color:#888; }

/* Sidebar */
.rr-sidebar { width:240px; flex-shrink:0; height:100%; background:#212127; color:#c7c6cc; display:flex; flex-direction:column; padding:14px 12px; gap:1px; overflow-y:auto; }
.rr-sidebar-top { display:flex; padding:2px 4px 12px 4px; }
.rr-icon-btn-dark { background:transparent; border:none; color:#8b8a92; padding:6px; border-radius:6px; cursor:pointer; display:flex; }
.rr-icon-btn-dark:hover { background:#1c1c20; color:#f2f2f4; }
.rr-navitem { display:block; background:transparent; border:none; color:#e4e4e7; text-align:left; padding:6px 4px; border-radius:4px; cursor:pointer; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; width:100%; }
.rr-navitem:hover { color:#ffffff; }
.rr-navitem-active { color:#9b8cff; }
.rr-navrow { position:relative; display:flex; align-items:stretch; gap:2px; }
.rr-navitem-grow { flex:1; }
.rr-navitem-calendar-btn { background:transparent; border:none; color:#8b8a92; padding:6px 6px; border-radius:4px; cursor:pointer; display:flex; align-items:center; flex-shrink:0; }
.rr-navitem-calendar-btn:hover { color:#f2f2f4; }

.rr-datepicker { position:fixed; z-index:90; background:#fff; border:1px solid #e2ded0; border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,.18); padding:10px 12px; width:225px; color:#1f1e1c; }
.rr-datepicker-head { display:flex; align-items:center; justify-content:space-between; font-size:12.3px; font-weight:600; margin-bottom:8px; }
.rr-datepicker-head button { background:transparent; border:none; color:#a9a79c; cursor:pointer; padding:3px; display:flex; border-radius:4px; }
.rr-datepicker-head button:hover { background:#f0eee5; color:#1f1e1c; }
.rr-datepicker-weekdays { display:grid; grid-template-columns:repeat(7,1fr); text-align:center; font-size:10px; color:#a9a79c; margin-bottom:4px; }
.rr-datepicker-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
.rr-datepicker-day { background:transparent; border:none; padding:6px 0; border-radius:6px; cursor:pointer; font-size:12px; color:#1f1e1c; }
.rr-datepicker-day:hover { background:#eee9ff; color:#5b46d6; }
.rr-datepicker-today { font-weight:700; color:#5b46d6; }
.rr-datepicker-empty { }

.rr-navdivider { height:1px; background:#232226; margin:12px 4px 10px 4px; }
.rr-navheader { display:flex; align-items:center; gap:6px; margin:0 4px 8px 4px; font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#a3a2aa; }
.rr-navheader svg { width:14px; height:14px; }
.rr-navlist { display:flex; flex-direction:column; gap:2px; overflow-y:auto; }
.rr-navitem-page { font-size:13px; font-weight:400; text-transform:none; letter-spacing:normal; color:#c7c6cc; padding:5px 4px; }
.rr-navitem-page.rr-navitem-active { color:#ffffff; font-weight:600; }
.rr-navempty { padding:4px; color:#5f5e66; font-size:11.5px; }

/* Main */
.rr-main { flex:1; display:flex; flex-direction:column; min-width:0; height:100%; min-height:0; }
.rr-topbar { display:flex; align-items:center; padding:10px 22px; border-bottom:1px solid #eeece6; background:#ffffff; gap:6px; flex-shrink:0; }
.rr-topbar-spacer { flex:1; }
.rr-icon-btn { border:none; background:transparent; color:#8a887e; padding:6px; border-radius:6px; cursor:pointer; display:flex; }
.rr-icon-btn:hover { background:#f2f0e9; color:#25231f; }
.rr-icon-btn-starred { color:#e0a915; }
.rr-savedot { width:7px; height:7px; border-radius:50%; background:#4caf6d; margin-right:2px; flex-shrink:0; }
.rr-savedot-saving { background:#e0a915; animation:rr-pulse 1s ease-in-out infinite; }
@keyframes rr-pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
.rr-pagemenu-wrap { position:relative; }
.rr-pagemenu-dropdown { position:absolute; top:calc(100% + 6px); right:0; z-index:60; background:#fff; border:1px solid #e2ded0; border-radius:8px; box-shadow:0 10px 26px rgba(0,0,0,.14); min-width:160px; padding:4px; }
.rr-pagemenu-item { display:flex; align-items:center; gap:7px; width:100%; background:transparent; border:none; text-align:left; padding:8px 10px; border-radius:6px; cursor:pointer; font-size:12.8px; color:#3a382f; }
.rr-pagemenu-item:hover { background:#f2f0e9; }
.rr-pagemenu-item-danger { color:#c0392b; }
.rr-pagemenu-item-danger:hover { background:#fbe9e9; }
.rr-topsearch { position:relative; display:flex; align-items:center; gap:7px; background:#fff; border:1px solid #e2ded0; border-radius:20px; padding:6px 14px; color:#a9a79c; width:230px; }
.rr-topsearch input { background:transparent; border:none; outline:none; font-size:12.8px; color:#1f1e1c; width:100%; }
.rr-topsearch input::placeholder { color:#b3b0a3; }
.rr-topsearch-dropdown { position:absolute; z-index:40; top:calc(100% + 6px); right:0; background:#fff; border:1px solid #ddd; border-radius:8px; box-shadow:0 10px 26px rgba(0,0,0,.14); min-width:260px; max-height:280px; overflow-y:auto; }
.rr-dropdown-item-new { color:#5b46d6; font-weight:600; }
.rr-content-scroll { flex:1; min-height:0; overflow-y:auto; padding:26px 40px 80px 40px; }
.rr-content-scroll > div { max-width:760px; margin:0 auto; width:100%; }

.rr-breadcrumb { display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:12.5px; color:#8c8a80; margin-bottom:10px; }
.rr-crumb { cursor:pointer; }
.rr-crumb:hover { color:#2563eb; text-decoration:underline; }
.rr-crumb-sep { color:#c8c5b8; }

.rr-title { font-size:32px; font-weight:700; margin:0 0 18px 0; letter-spacing:-.015em; color:#161511; }
.rr-empty-page { color:#a9a79c; font-size:13px; padding:6px 0; }

.rr-blocklist { display:flex; flex-direction:column; }
.rr-block { position:relative; }
.rr-add-above { position:absolute; top:-8px; width:16px; height:16px; border-radius:50%; background:#fff; border:1px solid #d8d4c5; color:#8a887e; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:0; transition:opacity .12s, background .12s, color .12s; z-index:6; padding:0; }
.rr-block:hover .rr-add-above { opacity:1; }
.rr-add-above:hover { background:#5b46d6; border-color:#5b46d6; color:#fff; }
.rr-row { display:flex; align-items:flex-start; gap:2px; padding:2px 0; position:relative; }
.rr-row-dragging { opacity:.4; }
.rr-row-dragover-above { box-shadow:inset 0 2px 0 0 #5b46d6; }
.rr-row-dragover-below { box-shadow:inset 0 -2px 0 0 #5b46d6; }
.rr-drag-handle { width:12px; height:20px; display:flex; align-items:center; justify-content:center; color:#c9c6b8; cursor:grab; flex-shrink:0; opacity:0; transition:opacity .12s; }
.rr-row:hover .rr-drag-handle { opacity:1; }
.rr-drag-handle:active { cursor:grabbing; }
.rr-collapse { width:14px; height:20px; display:flex; align-items:center; justify-content:center; background:transparent; border:none; color:#a19f93; cursor:pointer; flex-shrink:0; }
.rr-collapse-spacer { width:14px; flex-shrink:0; }
.rr-bullet-wrap { position:relative; flex-shrink:0; }
.rr-bullet { background:transparent; border:none; padding:2px 5px; cursor:pointer; display:flex; align-items:center; height:20px; flex-shrink:0; }
.rr-bullet-dot { width:5px; height:5px; border-radius:50%; background:#a19f93; display:block; }
.rr-bullet-dot-filled { background:#57554b; }
.rr-bullet:hover .rr-bullet-dot { background:#5b46d6; transform:scale(2.2); transition:transform .1s; }
.rr-bullet-number { background:transparent; border:none; padding:1px 5px 1px 2px; cursor:pointer; display:flex; align-items:center; justify-content:flex-end; height:20px; min-width:20px; flex-shrink:0; color:#8a887e; font-size:12.5px; font-variant-numeric:tabular-nums; font-weight:600; }
.rr-bullet-number:hover { color:#5b46d6; }
.rr-bulletmenu-dropdown { position:absolute; z-index:50; top:calc(100% + 4px); left:0; background:#fff; border:1px solid #e2ded0; border-radius:10px; box-shadow:0 14px 34px rgba(0,0,0,.16); min-width:210px; padding:6px; display:flex; flex-direction:column; }
.rr-bulletmenu-item { display:flex; align-items:center; gap:9px; width:100%; background:transparent; border:none; text-align:left; padding:8px 10px; border-radius:6px; cursor:pointer; font-size:13px; color:#3a382f; white-space:nowrap; }
.rr-bulletmenu-item:hover { background:#f2f0e9; }
.rr-bulletmenu-item-active { background:#eee9ff; color:#5b46d6; }
.rr-bulletmenu-item-static { color:#a9a79c; cursor:default; }
.rr-bulletmenu-item-static:hover { background:transparent; }
.rr-docview .rr-drag-handle, .rr-docview .rr-add-above { display:none; }
.rr-bullet-wrap-docview { opacity:0; margin-left:-4px; transition:opacity .12s; }
.rr-row:hover .rr-bullet-wrap-docview { opacity:1; }
.rr-docview .rr-children { border-left:none; margin-left:0; }
.rr-docview .rr-text { padding:5px 0 5px 0; line-height:1.75; }
.rr-content { flex:1; min-width:0; }
.rr-text { padding:3px 6px; border-radius:4px; cursor:text; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
.rr-text:hover { background:#efece1; }
.rr-empty { color:#b3b0a3; font-style:italic; }
.rr-todo-line { display:inline-flex; align-items:flex-start; gap:8px; }
.rr-todo-checkbox { margin-top:4px; width:15px; height:15px; cursor:pointer; accent-color:#5b46d6; flex-shrink:0; }
.rr-todo-text { display:inline; }
.rr-todo-checked { text-decoration:line-through; color:#a9a79c; }
.rr-heading { display:block; font-size:1.55em; font-weight:800; line-height:1.35; letter-spacing:-.01em; color:#161511; }
.rr-quote { display:block; border-left:3px solid #d8d4c5; background:rgba(216,212,197,0.16); padding:4px 10px 4px 14px; border-radius:0 5px 5px 0; font-style:italic; color:#57554b; }
.rr-hr-wrap { position:relative; display:flex; align-items:center; margin:10px 0; padding-right:24px; }
.rr-hr { flex:1; border:none; border-top:1px solid #ddd8c8; margin:0; }
.rr-hr-delete { position:absolute; right:0; top:50%; transform:translateY(-50%); background:transparent; border:none; color:#c9c6b8; cursor:pointer; padding:4px; border-radius:5px; opacity:0; transition:opacity .12s; }
.rr-hr-wrap:hover .rr-hr-delete { opacity:1; }
.rr-hr-delete:hover { background:#fbe9e9; color:#c0392b; }
.rr-pomodoro-wrap { position:relative; margin:10px 0; padding-right:24px; }
.rr-pomodoro { display:flex; align-items:center; gap:16px; background:#f7f5ee; border:1px solid #e2ded0; border-radius:12px; padding:12px 18px; max-width:420px; }
.rr-pomodoro-break { background:#eef6f0; border-color:#cfe6d6; }
.rr-pomodoro-tabs { display:flex; flex-direction:column; gap:2px; }
.rr-pomodoro-tab { background:transparent; border:none; text-align:left; padding:3px 8px; border-radius:5px; cursor:pointer; font-size:11.5px; font-weight:600; color:#a9a79c; }
.rr-pomodoro-tab-active { background:#e7e2ff; color:#5b46d6; }
.rr-pomodoro-break .rr-pomodoro-tab-active { background:#d8f0df; color:#1f7a45; }
.rr-pomodoro-time { font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; color:#25231f; min-width:76px; }
.rr-pomodoro-controls { display:flex; gap:6px; margin-left:auto; }
.rr-pomodoro-btn { background:#5b46d6; color:#fff; border:none; border-radius:6px; padding:7px 14px; font-size:12.5px; cursor:pointer; }
.rr-pomodoro-btn:hover { background:#4a37c2; }
.rr-pomodoro-btn-ghost { background:transparent; color:#8a887e; border:1px solid #ddd8c8; }
.rr-pomodoro-btn-ghost:hover { background:#efece1; color:#57554b; }
.rr-pomodoro-delete { right:0; top:14px; transform:none; opacity:1; background:#fff; border:1px solid #e2ded0; }
.rr-pomodoro-delete:hover { background:#fbe9e9; color:#c0392b; border-color:#f0c8c8; }
.rr-encrypted-wrap { position:relative; margin:10px 0; padding-right:24px; }
.rr-encrypted { background:#2a2830; color:#e7e6ec; border-radius:12px; padding:14px 18px; max-width:420px; }
.rr-encrypted-head { display:flex; align-items:center; gap:7px; font-size:13px; font-weight:700; color:#f0f0f2; margin-bottom:6px; }
.rr-encrypted-hint { font-size:12px; color:#9b98a2; margin-bottom:10px; font-style:italic; }
.rr-encrypted-form { display:flex; gap:6px; }
.rr-encrypted-input { flex:1; background:#18171c; border:1px solid #3a3843; border-radius:6px; padding:7px 10px; font-size:12.5px; color:#e7e6ec; outline:none; }
.rr-encrypted-input:focus { border-color:#9b8cff; }
.rr-encrypted-unlock { background:#5b46d6; color:#fff; border:none; border-radius:6px; padding:7px 14px; font-size:12.5px; cursor:pointer; }
.rr-encrypted-unlock:hover { background:#4a37c2; }
.rr-encrypted-unlock:disabled { opacity:.5; cursor:default; }
.rr-encrypted-error { color:#f39a9a; font-size:11.5px; margin-top:6px; }
.rr-encrypted-revealed { font-size:13px; line-height:1.55; white-space:pre-wrap; word-break:break-word; margin-bottom:10px; }
.rr-encrypted-lock { display:flex; align-items:center; gap:6px; background:transparent; border:1px solid #3a3843; color:#c7c6cc; border-radius:6px; padding:5px 10px; font-size:11.5px; cursor:pointer; }
.rr-encrypted-lock:hover { background:#332f3d; }
.rr-encrypted-delete { right:0; top:14px; transform:none; opacity:1; background:#fff; border:1px solid #e2ded0; }
.rr-encrypted-delete:hover { background:#fbe9e9; color:#c0392b; border-color:#f0c8c8; }
.rr-children { margin-left: 6px; border-left:1px solid #eae7dc; }
.rr-refcount { align-self:center; background:#e7e2ff; color:#5b46d6; border:none; border-radius:9px; font-size:10.5px; padding:1px 7px; cursor:pointer; margin-left:4px; flex-shrink:0; }
.rr-refcount:hover { background:#d7cfff; }

.rr-editor-wrap { position:relative; }
.rr-editor { width:100%; resize:none; border:1px solid #cdd7ff; border-radius:5px; padding:3px 6px; font:inherit; line-height:1.55; background:#fbfcff; outline:none; overflow:hidden; }
.rr-editor-cell { padding:2px 4px; }
.rr-dropdown { position:absolute; z-index:40; top:100%; left:0; margin-top:2px; background:#fff; border:1px solid #ddd; border-radius:6px; box-shadow:0 6px 20px rgba(0,0,0,.12); min-width:240px; max-width:420px; max-height:220px; overflow-y:auto; }
.rr-dropdown-item { padding:7px 10px; font-size:12.8px; cursor:pointer; }
.rr-dropdown-slash-item { display:flex; align-items:center; justify-content:space-between; gap:14px; }
.rr-dropdown-sub { color:#a9a79c; font-size:11.5px; }
.rr-dropdown-item:hover { background:#f0f0ff; }

.rr-link { color:#3a63d8; cursor:pointer; padding:0 2px; font-weight:400; font-size:1.08em; }
.rr-link:hover { text-decoration:underline; }
.rr-refchip { color:#5b46d6; background:#f1edff; border-radius:3px; padding:0 5px; cursor:pointer; font-size:12.5px; border-bottom:1px dashed #c6b9ff; }
.rr-tag { color:#0f8a6a; background:#e7f7ef; border-radius:3px; padding:0 4px; }
.rr-inline-img-wrap { display:inline-block; position:relative; max-width:100%; min-width:60px; min-height:40px; overflow:hidden; resize:both; border-radius:8px; vertical-align:top; margin:6px 0; border:1px solid #eae7dc; }
.rr-inline-img { width:100%; height:100%; object-fit:cover; display:block; }
.rr-inline-link { color:#2563eb; text-decoration:underline; cursor:pointer; word-break:break-all; }
.rr-comment { color:#4a4a4f; font-style:italic; }
.rr-highlight { background:#fdf0a3; color:#2b2a24; border-radius:2px; padding:0 2px; }

.rr-insert-toolbar { display:flex; gap:2px; margin-top:3px; }
.rr-insert-toolbar button { background:transparent; border:none; color:#a9a79c; padding:4px 6px; border-radius:5px; cursor:pointer; display:flex; align-items:center; }
.rr-insert-toolbar button:hover { background:#efece1; color:#57554b; }
.rr-insert-popover { position:absolute; z-index:45; top:100%; left:0; margin-top:2px; background:#fff; border:1px solid #ddd; border-radius:8px; box-shadow:0 8px 22px rgba(0,0,0,.14); padding:8px; display:flex; flex-direction:column; gap:6px; min-width:240px; }
.rr-insert-input { border:1px solid #ddd; border-radius:5px; padding:6px 8px; font:inherit; font-size:12.5px; outline:none; }
.rr-insert-input:focus { border-color:#9b8cff; }
.rr-insert-add { align-self:flex-end; background:#5b46d6; color:#fff; border:none; border-radius:5px; padding:5px 12px; font-size:12px; cursor:pointer; }
.rr-insert-add:hover { background:#4a37c2; }
.rr-insert-preview-strip { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; padding:6px; background:#faf9f4; border:1px dashed #e2ded0; border-radius:6px; }
.rr-insert-preview-thumb { height:56px; width:auto; max-width:120px; object-fit:cover; border-radius:5px; border:1px solid #e2ded0; }
.rr-sel-toolbar { position:absolute; z-index:55; display:flex; gap:1px; background:#232226; border-radius:7px; padding:3px; box-shadow:0 8px 20px rgba(0,0,0,.28); transform:translateY(-100%); }
.rr-sel-toolbar button { background:transparent; border:none; color:#f0f0f2; padding:5px 8px; border-radius:5px; cursor:pointer; display:flex; align-items:center; }
.rr-sel-toolbar button:hover { background:#39383f; }

.rr-add-block { margin-top:8px; align-self:flex-start; display:flex; align-items:center; gap:5px; background:transparent; border:none; color:#a9a79c; font-size:12.5px; cursor:pointer; padding:5px 6px; border-radius:5px; }
.rr-add-block:hover { background:#efece1; color:#57554b; }

.rr-orphan-hint { background:#fbf5e6; border:1px solid #ecdfb8; color:#8a6d1f; font-size:12.5px; border-radius:8px; padding:9px 12px; margin-bottom:16px; line-height:1.5; }
.rr-link-preview { color:#5b46d6; font-weight:600; }

.rr-linked { margin-top:36px; border-top:1px solid #e8e5dc; padding-top:16px; }
.rr-linked h3 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#8c8a80; margin:0 0 10px 0; }
.rr-linked-group { margin-bottom:14px; }
.rr-linked-group-title { display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:#4a473e; cursor:pointer; margin-bottom:4px; }
.rr-linked-group-title:hover { color:#5b46d6; }
.rr-linked-item { font-size:13px; line-height:1.55; padding:5px 10px 5px 20px; border-left:2px solid #e8e2ff; cursor:pointer; border-radius:0 4px 4px 0; }
.rr-linked-item:hover { background:#f5f2ff; }

.rr-unlinked { margin-top:28px; border-top:1px solid #e8e5dc; padding-top:16px; }
.rr-unlinked h3 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#8c8a80; margin:0 0 10px 0; }
.rr-unlinked-item { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:8px 10px; border-radius:6px; background:#fbfaf6; margin-bottom:6px; }
.rr-unlinked-text { font-size:13px; line-height:1.5; }
.rr-unlinked-page { color:#a9a79c; font-size:11.5px; }
.rr-link-btn { display:flex; align-items:center; gap:4px; background:#5b46d6; color:#fff; border:none; border-radius:5px; padding:4px 9px; font-size:11.5px; cursor:pointer; flex-shrink:0; }
.rr-link-btn:hover { background:#4a37c2; }

.rr-table-wrap { margin:6px 0 6px 20px; }
.rr-table { border-collapse:collapse; font-size:13px; }
.rr-table td.rr-td { border:1px solid #e2ded0; padding:5px 10px; min-width:90px; cursor:text; }
.rr-table td.rr-td:hover { background:#f4f2e9; }

.rr-graph { }
.rr-graph-sub { color:#8c8a80; font-size:12.5px; margin:-10px 0 14px 0; }
.rr-graph-svg { width:100%; height:70vh; background:#fbfaf7; border:1px solid #e8e5dc; border-radius:10px; }
.rr-edge { stroke:#d9d5c8; stroke-width:1.4; }
.rr-node { cursor:pointer; }
.rr-node circle { fill:#5b46d6; opacity:.85; }
.rr-node:hover circle { opacity:1; }
.rr-node text { font-size:11px; fill:#4a473e; }

.rr-btn-danger { display:flex; align-items:center; gap:5px; background:#c0392b; color:#fff; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; }
.rr-btn-danger:hover { background:#a5301f; }

.rr-allpages { display:flex; flex-direction:column; gap:2px; }
.rr-allpages-item { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:6px; cursor:pointer; position:relative; padding-right:38px; }
.rr-allpages-item:hover { background:#efece1; }
.rr-star-btn { background:transparent; border:none; color:#c9c6b8; cursor:pointer; padding:2px; display:flex; flex-shrink:0; }
.rr-star-btn:hover { color:#e0a915; }
.rr-star-btn-active { color:#e0a915; }
.rr-allpages-title { flex:1; }
.rr-allpages-count { color:#a9a79c; font-size:11.5px; }
.rr-allpages-delete { position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:#c9c6b8; cursor:pointer; padding:5px; border-radius:5px; opacity:0; }
.rr-allpages-item:hover .rr-allpages-delete { opacity:1; }
.rr-allpages-delete:hover { background:#fbe9e9; color:#c0392b; }

.rr-rightbar { flex-shrink:0; height:100%; border-left:1px solid #c3cdd6; background:#dbe3ea; display:flex; flex-direction:column; overflow-y:auto; position:relative; }
.rr-rightbar-resizer { position:absolute; top:0; left:-5px; width:10px; height:100%; cursor:col-resize; z-index:10; }
.rr-rightbar-resizer:hover, .rr-rightbar-resizer:active { background:rgba(91,70,214,0.22); }
.rr-sidepanel { border-bottom:1px solid #c3cdd6; padding:18px 22px; }
.rr-sidepanel-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-size:16px; color:#1f2937; }
.rr-sidepanel-close { background:transparent; border:none; color:#5c6672; cursor:pointer; }
.rr-sidepanel-close:hover { color:#1f2937; }
.rr-sidepanel-body { font-size:14.5px; color:#2b3542; }

.rr-rightbar .rr-text { color:#2b3542; }
.rr-rightbar .rr-todo-checked { color:#7c8794; }
.rr-rightbar .rr-heading { color:#1f2937; }
.rr-rightbar .rr-quote { border-left-color:#a9b7c4; background:rgba(169,183,196,0.14); color:#4b5563; }
.rr-rightbar .rr-hr { border-top-color:#b9c7d4; }
.rr-rightbar .rr-pomodoro { background:#eef2f5; border-color:#c3cdd6; }
.rr-rightbar .rr-pomodoro-break { background:#e4f0e8; border-color:#bcd8c6; }
.rr-rightbar .rr-pomodoro-time { color:#1f2937; }
.rr-rightbar .rr-highlight { background:#f3dd7a; color:#241f10; }
.rr-rightbar .rr-text:hover { background:#cbd6df; }
.rr-rightbar .rr-empty { color:#7c8794; }
.rr-rightbar .rr-children { border-left:1px solid #c3cdd6; }
.rr-rightbar .rr-collapse { color:#5c6672; }
.rr-rightbar .rr-bullet-dot { background:#5c6672; }
.rr-rightbar .rr-bullet-dot-filled { background:#2b3542; }
.rr-rightbar .rr-bullet-number { color:#5c6672; }
.rr-rightbar .rr-bullet-number:hover { color:#5b46d6; }
.rr-rightbar .rr-bullet:hover .rr-bullet-dot { background:#5b46d6; }
.rr-rightbar .rr-link { color:#2f4fb8; }
.rr-rightbar .rr-refchip { color:#4432a8; background:#c9d4de; border-bottom-color:#a9b7c4; }
.rr-rightbar .rr-tag { color:#0f7a5c; background:#c7ddd2; }
.rr-rightbar .rr-refcount { background:#c9d4de; color:#4432a8; }
.rr-rightbar .rr-refcount:hover { background:#b9c7d4; }
.rr-rightbar .rr-editor { background:#eef2f5; border-color:#a9b7c4; color:#1f2937; }
.rr-rightbar .rr-dropdown { background:#eef2f5; border-color:#c3cdd6; }
.rr-rightbar .rr-dropdown-item { color:#2b3542; }
.rr-rightbar .rr-dropdown-item:hover { background:#dbe3ea; }
.rr-rightbar .rr-td { border-color:#c3cdd6; }
.rr-rightbar .rr-td:hover { background:#cbd6df; }
.rr-rightbar .rr-empty-page { color:#7c8794; }
.rr-rightbar .rr-add-above { background:#eef2f5; border-color:#c3cdd6; color:#5c6672; }
.rr-rightbar .rr-add-above:hover { background:#5b46d6; border-color:#5b46d6; color:#fff; }
.rr-rightbar .rr-insert-toolbar button { color:#7c8794; }
.rr-rightbar .rr-insert-toolbar button:hover { background:#cbd6df; color:#2b3542; }
.rr-rightbar .rr-insert-popover { background:#eef2f5; border-color:#c3cdd6; }
.rr-rightbar .rr-insert-input { background:#f6f8fa; border-color:#a9b7c4; color:#1f2937; }
.rr-rightbar .rr-inline-img-wrap { border-color:#c3cdd6; }
.rr-rightbar .rr-inline-link { color:#2f4fb8; }
.rr-rightbar .rr-comment { color:#5c6672; }
.rr-rightbar .rr-insert-preview-strip { background:#eef2f5; border-color:#c3cdd6; }
.rr-rightbar .rr-insert-preview-thumb { border-color:#c3cdd6; }

.rr-modal-backdrop { position:fixed; inset:0; background:rgba(20,18,30,.45); display:flex; align-items:center; justify-content:center; z-index:100; }
.rr-modal { background:#fff; border-radius:10px; padding:20px; width:440px; max-width:90vw; max-height:80vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.25); }
.rr-modal h3 { margin:0 0 6px 0; font-size:16px; }
.rr-modal-sub { color:#a9a79c; font-size:12px; margin:0 0 12px 0; }
.rr-ref-source { background:#f4f2e9; border-radius:6px; padding:8px 10px; font-size:12.5px; color:#57554b; margin-bottom:12px; }
.rr-ref-list { display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto; }
.rr-ref-item { background:#fbfaf6; border-radius:6px; padding:8px 10px; cursor:pointer; font-size:13px; }
.rr-ref-item:hover { background:#efece1; }
.rr-ref-page { font-size:11px; color:#5b46d6; margin-bottom:2px; }
.rr-modal-close { margin-top:14px; background:#efece1; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; }
.rr-quickcapture-input { width:100%; min-height:90px; border:1px solid #ddd; border-radius:6px; padding:8px 10px; font:inherit; resize:vertical; outline:none; box-sizing:border-box; }
.rr-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.rr-btn-ghost { background:transparent; border:1px solid #ddd; padding:7px 14px; border-radius:6px; cursor:pointer; }
.rr-btn-primary { background:#5b46d6; color:#fff; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; }
.rr-btn-primary:hover { background:#4a37c2; }

@media (max-width: 860px) {
  .rr-sidebar { position:fixed; z-index:60; height:100%; }
  .rr-rightbar { position:fixed; right:0; height:100%; z-index:55; }
  .rr-content-scroll { padding:18px; }
}
`;
