// Theia Loot — loot from fallen NPCs without converting their sheets.
// Phase 1: a "Droppable" toggle per item on NPC sheets, a prompt for the GM when an NPC dies, and a loot window
// that players open on the body (double click, or the Token HUD) to take what it carried.

const MODULE_ID = "theia-loot";
const SOCKET = `module.${MODULE_ID}`;
const PHYSICAL = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "askOnDeath", {
    name: "Ask when an NPC dies",
    hint: "When an NPC gets the Dead condition or is marked defeated in the combat tracker, ask the GM whether the body becomes lootable.",
    scope: "world", config: true, type: String, default: "ask",
    choices: { ask: "Ask the GM", always: "Always lootable (no question)", never: "Never (only by hand, from the Token HUD)" }
  });
  game.settings.register(MODULE_ID, "range", {
    name: "Loot distance (ft)",
    hint: "How close a player's token must be to the body to open its loot. 0 = any distance.",
    scope: "world", config: true, type: Number, default: 5
  });
});

/* -------------------------------------------- */
/*  Droppable items                             */
/* -------------------------------------------- */

/** Natural weapons, features and spells never drop by default; gear, consumables and treasure do. */
export function isDroppable(item) {
  const flag = item.getFlag(MODULE_ID, "droppable");
  if (typeof flag === "boolean") return flag;
  if (!PHYSICAL.includes(item.type)) return false;
  if (item.type === "weapon" && item.system.type?.value === "natural") return false;
  return true;
}

const lootOf = token => token?.getFlag?.(MODULE_ID, "loot") ?? null;
const isLootable = token => !!lootOf(token)?.enabled;

/** The items still on the body that can be taken. */
export function availableItems(token) {
  const actor = token?.actor;
  if (!actor) return [];
  return actor.items.filter(i => PHYSICAL.includes(i.type) && isDroppable(i) && (i.system.quantity ?? 1) > 0 && !i.system.container);
}

Hooks.on("renderNPCActorSheet", (app, element) => {
  if (!game.user.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0] ?? app.element;
  for (const row of root.querySelectorAll("li.item[data-item-id]")) {
    const item = app.actor.items.get(row.dataset.itemId);
    if (!item || !PHYSICAL.includes(item.type)) continue;
    const controls = row.querySelector(".item-controls");
    if (!controls || controls.querySelector(".theia-loot-toggle")) continue;
    const on = isDroppable(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `unbutton config-button item-control theia-loot-toggle${on ? " active" : ""}`;
    button.dataset.tooltip = on ? "Droppable: drops as loot" : "Not droppable";
    button.innerHTML = `<i class="fa-solid ${on ? "fa-sack-dollar" : "fa-sack-xmark"}"></i>`;
    button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      item.setFlag(MODULE_ID, "droppable", !isDroppable(item));
    });
    controls.prepend(button);
  }
});

/* -------------------------------------------- */
/*  Death                                       */
/* -------------------------------------------- */

const asked = new Set();

function tokenOf(actor) {
  if (actor?.isToken) return actor.token;
  return actor?.getActiveTokens(false, true).find(t => t.parent === canvas.scene) ?? actor?.getActiveTokens(false, true)[0] ?? null;
}

async function onDeath(token) {
  if (!token || !game.users.activeGM?.isSelf) return;
  if (token.actor?.type !== "npc" || isLootable(token) || asked.has(token.uuid)) return;
  asked.add(token.uuid);
  setTimeout(() => asked.delete(token.uuid), 10000);
  const mode = game.settings.get(MODULE_ID, "askOnDeath");
  if (mode === "never") return;
  let yes = mode === "always";
  if (!yes) {
    const count = availableItems(token).length;
    yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Theia Loot" },
      content: `<p><b>${token.name}</b> has died. Make the body lootable?</p><p><small>${count} droppable item(s) on the body.</small></p>`,
      rejectClose: false
    });
  }
  if (yes) await setLootable(token, true);
}

export async function setLootable(token, enabled) {
  if (enabled) await token.setFlag(MODULE_ID, "loot", { enabled: true, since: Date.now() });
  else await token.unsetFlag(MODULE_ID, "loot");
}

Hooks.on("createActiveEffect", effect => {
  if (effect.statuses?.has("dead") && effect.parent instanceof Actor) onDeath(tokenOf(effect.parent));
});
Hooks.on("updateCombatant", (combatant, changes) => {
  if (changes.defeated === true) onDeath(combatant.token);
});

/* -------------------------------------------- */
/*  Token icon                                  */
/* -------------------------------------------- */

const ICON = "icons/svg/chest.svg";
Hooks.on("refreshToken", token => {
  const lootable = isLootable(token.document);
  let icon = token.children.find(c => c.name === "theia-loot-icon");
  if (!lootable) { if (icon) { token.removeChild(icon); icon.destroy(); } return; }
  if (!icon) {
    icon = PIXI.Sprite.from(ICON);
    icon.name = "theia-loot-icon";
    icon.tint = 0xf2c14e;
    token.addChild(icon);
  }
  const s = Math.min(token.w, token.h) * 0.32;
  icon.width = icon.height = s;
  icon.position.set(token.w - s * 0.9, -s * 0.1);
  icon.alpha = availableItems(token.document).length ? 1 : 0.4;
});
Hooks.on("updateToken", (doc, changes) => {
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) doc.object?.renderFlags.set({ refresh: true });
});

/* -------------------------------------------- */
/*  Opening the loot                            */
/* -------------------------------------------- */

/** The looter: the user's character, or a token they control on the scene. */
function looterFor(user = game.user) {
  const controlled = canvas.tokens.controlled.find(t => t.actor?.isOwner && t.actor.type === "character");
  return controlled?.actor ?? user.character ?? null;
}

function canReach(token, looter) {
  const range = Number(game.settings.get(MODULE_ID, "range")) || 0;
  if (!range || game.user.isGM) return true;
  const mine = looter?.getActiveTokens().find(t => t.document.parent === token.parent);
  if (!mine) return false;
  const d = canvas.grid.measurePath([mine.center, token.object.center]).distance;
  const reach = range + (Math.max(token.width, token.height) * canvas.grid.distance) / 2 + (Math.max(mine.document.width, mine.document.height) * canvas.grid.distance) / 2 - canvas.grid.distance;
  return d <= reach + 0.1;
}

export function openLoot(token) {
  token = token?.document ?? token;
  if (!isLootable(token)) return ui.notifications.warn("This body is not lootable.");
  const looter = looterFor();
  if (!game.user.isGM && !looter) return ui.notifications.warn("Select your character to loot.");
  if (!canReach(token, looter)) return ui.notifications.warn("Move closer to the body to loot it.");
  const existing = foundry.applications.instances.get(`theia-loot-${token.id}`);
  if (existing) return existing.bringToFront();
  new LootWindow(token).render(true);
}

Hooks.once("ready", () => {
  const Token = foundry.canvas.placeables.Token;
  const original = Token.prototype._onClickLeft2;
  Token.prototype._onClickLeft2 = function(event) {
    // Players double-click a lootable body to open it; the GM keeps the sheet (Alt + double click opens the loot).
    if (isLootable(this.document) && (!game.user.isGM || event?.altKey)) return openLoot(this.document);
    return original.call(this, event);
  };
  game.modules.get(MODULE_ID).api = { isDroppable, availableItems, setLootable, openLoot };
  game.socket.on(SOCKET, onSocket);
});

Hooks.on("renderTokenHUD", (hud, element) => {
  const token = hud.document;
  if (token.actor?.type !== "npc") return;
  const root = element instanceof HTMLElement ? element : element[0];
  const column = root.querySelector(".col.right") ?? root.querySelector(".right");
  if (!column) return;
  const lootable = isLootable(token);
  if (!game.user.isGM && !lootable) return;
  const button = document.createElement("div");
  button.className = `control-icon theia-loot-hud${lootable ? " active" : ""}`;
  button.dataset.tooltip = game.user.isGM ? (lootable ? "Theia Loot: open (right click: stop)" : "Theia Loot: make lootable") : "Theia Loot: open";
  button.innerHTML = `<i class="fa-solid fa-sack-dollar"></i>`;
  button.addEventListener("click", async event => {
    event.preventDefault();
    if (game.user.isGM && !lootable) { await setLootable(token, true); return hud.render(); }
    openLoot(token);
  });
  button.addEventListener("contextmenu", async event => {
    event.preventDefault();
    if (game.user.isGM && lootable) { await setLootable(token, false); hud.render(); }
  });
  column.append(button);
});

/* -------------------------------------------- */
/*  Taking items (through the GM)               */
/* -------------------------------------------- */

async function take({ tokenUuid, itemId, actorUuid, userId, all }) {
  const token = await fromUuid(tokenUuid);
  const recipient = await fromUuid(actorUuid);
  if (!token?.actor || !recipient || !isLootable(token)) return;
  const items = all ? availableItems(token) : [token.actor.items.get(itemId)].filter(i => i && isDroppable(i));
  if (!items.length) return;
  const data = items.map(i => {
    const o = i.toObject(); delete o._id;
    foundry.utils.setProperty(o, "system.equipped", false);
    foundry.utils.setProperty(o, `flags.${MODULE_ID}.from`, token.name);
    return o;
  });
  await recipient.createEmbeddedDocuments("Item", data);
  await token.actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
  const who = game.users.get(userId)?.character?.name ?? recipient.name;
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: recipient }),
    content: `<p><b>${who}</b> took from <b>${token.name}</b>: ${items.map(i => `${i.name}${(i.system.quantity ?? 1) > 1 ? ` ×${i.system.quantity}` : ""}`).join(", ")}.</p>`
  });
}

function onSocket(message) {
  if (!game.users.activeGM?.isSelf) return;
  if (message?.action === "take") take(message);
}

function requestTake(payload) {
  if (game.user.isGM) return take({ ...payload, userId: game.user.id });
  if (!game.users.activeGM) return ui.notifications.warn("A GM must be online to take items.");
  game.socket.emit(SOCKET, { action: "take", ...payload, userId: game.user.id });
}

/* -------------------------------------------- */
/*  Loot window                                 */
/* -------------------------------------------- */

class LootWindow extends foundry.applications.api.ApplicationV2 {
  constructor(token) {
    super({ id: `theia-loot-${token.id}` });
    this.token = token;
    this._hooks = [];
  }

  static DEFAULT_OPTIONS = {
    classes: ["theia-loot"],
    window: { title: "Loot", icon: "fa-solid fa-sack-dollar", resizable: true },
    position: { width: 420, height: "auto" }
  };

  get title() { return `Loot: ${this.token.name}`; }

  async _renderHTML() {
    const items = availableItems(this.token);
    const looter = looterFor();
    const rows = items.map(i => {
      const name = (i.system.identified === false && !game.user.isGM) ? (i.system.unidentified?.name || "Unidentified item") : i.name;
      const qty = i.system.quantity ?? 1;
      return `<li class="theia-loot-item" data-item-id="${i.id}">
        <img src="${i.img}" alt="">
        <span class="name">${name}${qty > 1 ? ` <small>×${qty}</small>` : ""}</span>
        <button type="button" data-take="${i.id}"><i class="fa-solid fa-hand"></i> Take</button>
      </li>`;
    }).join("");
    const div = document.createElement("div");
    div.className = "theia-loot-body";
    div.innerHTML = `
      <header><img src="${this.token.texture.src}" alt=""><div><h3>${this.token.name}</h3>
        <p>${looter ? `Looting as <b>${looter.name}</b>` : "Select a character to take items."}</p></div></header>
      ${items.length ? `<ul class="theia-loot-list">${rows}</ul>` : `<p class="empty">Nothing left to take.</p>`}
      ${items.length > 1 ? `<footer><button type="button" data-take-all><i class="fa-solid fa-hands"></i> Take all</button></footer>` : ""}`;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.querySelectorAll("[data-take]").forEach(b => b.addEventListener("click", () => this._take(b.dataset.take)));
    content.querySelector("[data-take-all]")?.addEventListener("click", () => this._take(null, true));
  }

  _take(itemId, all = false) {
    const looter = looterFor();
    if (!looter) return ui.notifications.warn("Select your character to take items.");
    requestTake({ tokenUuid: this.token.uuid, itemId, actorUuid: looter.uuid, all });
  }

  _onFirstRender() {
    const refresh = doc => {
      const actor = doc?.parent ?? doc;
      if (actor === this.token.actor || doc === this.token) this.render();
    };
    for (const hook of ["createItem", "deleteItem", "updateItem", "updateToken"]) this._hooks.push([hook, Hooks.on(hook, refresh)]);
    this._hooks.push(["controlToken", Hooks.on("controlToken", () => this.render())]);
  }

  _onClose() {
    for (const [hook, id] of this._hooks) Hooks.off(hook, id);
  }
}
