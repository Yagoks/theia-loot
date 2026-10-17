# Theia Loot

Loot from fallen NPCs in Foundry VTT v13 / dnd5e 5.x, without converting their sheets into loot sheets.

## Phase 1

- **Droppable toggle.** On NPC sheets the GM sees a sack button on each physical item (next to the equip shield). Gold sack = drops as loot, crossed sack = stays on the body. By default gear, consumables and treasure drop; natural weapons, features and spells don't.
- **On death.** When an NPC gets the **Dead** condition or is marked **defeated** in the combat tracker, the GM is asked whether the body becomes lootable (setting: ask / always / never). All text is in English.. A lootable body shows a gold chest on its token.
- **Loot window.** Players double-click the body (or use the Token HUD sack) to open it, within the loot distance (default 5 ft). Each droppable item can be taken, or all at once; the item moves to the looting character, through the GM, with a chat message. The GM opens it with Alt + double click or the HUD, and can make a body lootable by hand (HUD) or stop it (right click on the HUD sack).

## Next

- Phase 2: a Loot tab on NPC sheets with a d100 drop table, coins and the roll animation.
- Phase 3: harvest checks by creature type (DC 10 identify, 15/20/25/35 for 1–4 rolls on the table; a natural 20 guarantees a top result).
