# L RPG

A small turn-based tactical RPG that runs in the browser, built with [Phaser 4](https://phaser.io), TypeScript and Vite.

## How the game works

1. **Main menu**: New Game, Continue, Save Game, Load Game, and **Quick Battle (Demo)**: the original game on its own. Recruit up to 4 Adventurers for free at a camp (any look, weapon and skills), then fight stages 1 to 5; every victory is worth exactly one level, and clearing stage 5 completes the demo. The **Enemies** slider at camp raises the difficulty: it multiplies the encounter's size from 1x to 5x in 0.5 steps (5x at stage 1 is 30 rats, whatever the size of your party). Big encounters deploy further toward the middle of the map. The demo is separate from your Arch City campaign and isn't saved.
2. **Your character**: a new game starts by creating your main character (name, sex, skin, face, hair, hair colour, clothes colour, weapon, skills) and naming your party. The main character is permanent: they can't be dismissed, but they can be **benched** (Manage Party) to rest in the city while the rest of the party goes on quests without them.
3. **Arch City**: the hub is a map of the walled city (`public/art/city/arch-city.webp`) with two tabs: the **Outer City**, between the outer and inner walls and out to the harbour (Adventurer Guild, the domed hall in the south-west; Docks, Marketplace, Slave Market, Slums, Customs Office, Tailor, Auction House, Church, Sleeping Griffin Inn, Outer City House), and the **Inner City**, inside the inner wall (Lord's Manor, Central Church, Central Government Office, Library, Estate Office, Silver Lantern Inn, Gilded Crown Inn, Inner City Townhouse, Inner City Mansion). Click a pin on the map or a button below it. Open so far: the **Adventurer Guild**, the **Slave Market**, the **Estate Office**, the three **inns** and the three **residences**; the rest are greyed out. **Manage Party** (bottom bar) handles your members, their schedule, food and lodging, **End Day** ends the day, and the side panel sets out on an accepted quest. See [Arch City and the guild](#arch-city-and-the-adventurer-guild).
4. **Adventurers**: There are no fixed classes. Every party member is an Adventurer, and you build them by mixing a weapon with picks from the skill trees. Up to 4 go on each quest (the lineup); the party can have up to 8 members.
5. **Tactical battle**: XCOM-style alternating turns. On your turn, every Adventurer has **2 AP** (action points), a movement AP and an action AP, and can spend them in any order (click a unit or press Tab). See [Action points and mana](#action-points-and-mana). Skills sit on the **skill bar** under the map: press **1–0** (or click a slot) to use one. Each slot shows its AP cost along the bottom (**Ends Turn**, **1AP**, **2AP** or **free**) and its mana cost at the top. By default slot 1 is the basic attack, 2 Overwatch, 3 Dash, and the rest follow; newly learned skills go after the last used slot. **Drag a slot onto another** to swap them (the layout is saved per character). With more than 10 skills the bar gets more pages: flip with ▲ ▼ or **[ ]**, and while dragging, hover ▲ ▼ to carry a skill to another page (or to a new empty one). The battle log is in the sidebar. Hover a skill to see its range box; any tile in range can be targeted. The map is 18×13 tiles (set in `stats.json`). Terrain: grass costs 4 Movement, forest 6 (and gives +20 Defense), river 8. Rock and deep water block movement, and rock blocks line of sight.

## Arch City and the Adventurer Guild

The management and simulation side of the game (Arch City, the guild, contracts, days) is the **Strategic Layer**; battles are the **Tactical Layer**.

Time passes in days. **End Day** (the city's bottom bar) ends the day: everyone the party houses (the main character, slaves, and companions whose contract includes food and lodging) spends the night **where they lodge**, set per member in **Manage Party**: **outside**, one of the three **inns**, or a **residence** the party owns. Each member pays for their own night. A quest doesn't end the day: the party comes back in the evening, and you can only go on **one quest a day** (you can accept the next one, but set out tomorrow). A quest that takes several days spends the nights before the last on the road. Lodging:

| Where | Per person per night | Quality |
|---|---|---|
| Outside (everyone's default) | free | 0 |
| Sleeping Griffin Inn (Outer City) | 10 gold | 1 |
| Silver Lantern Inn (Inner City, high-end) | 30 gold | 2 |
| Gilded Crown Inn (Inner City, luxury) | 90 gold | 3 |
| Your residence (Outer City House / Inner City Townhouse / Mansion), up to 6 residents each | free | 1 / 2 / 3 |
| On the road (multi-day quests) | free (food is still paid) | doesn't count |

**Inns** are otherwise just for **drinks** (a round for the whole party, once a day); more is coming there later.

**Food** is paid every day (in the city and on the road) and set per member in **Manage Party** (`food` in `guild.json`):

| Food | Per person per day | Quality |
|---|---|---|
| Poor | 2 gold | 0 |
| Common (default) | 6 gold | 1 |
| Fine | 18 gold | 2 |
| Luxury | 54 gold | 3 |

Companions whose contract doesn't include food and lodging find their own (their food and lodging choices are greyed out), as do mercenaries.

**Residences** are bought and sold at the **Estate Office** (Inner City): the **Outer City House 4,000 gold**, the **Inner City Townhouse 12,000** and the **Inner City Mansion 36,000**; the office buys one back for 70% of its price. Each houses **at most 6 residents** whatever its tier (`residences.capacity`), and nights there are free and count as good as the Sleeping Griffin, the Silver Lantern and the Gilded Crown respectively. Each residence has its own pin on the map showing who lives there (the Estate Office lists them too). Selling a residence sends its residents outside until you move them.

**Expectations** follow each adventurer's rank (see below): **D**-rank adventurers are fine sleeping outside, **C** expect an inn or the Outer City House, **B** a high-end inn or the Townhouse, **A** and **S** the luxury inn or the Mansion. Each night, every companion the party houses gains **+2 relationship** if they slept better than they expect, and loses **3 per quality step** worse: an A-rank companion loses 9 for a night outside. Food works the same way against the same expectations (D poor, C common, B fine, A and S luxury), at **+1** for better food and **−2 per step** worse; slaves count too. (`lodging`, `food` and `residences` in `guild.json`.)

### Health, Morale and the schedule

Party members have two Strategic Layer stats, both out of 100 (`condition` and `schedule` in `guild.json`):

- **Health** is not battle HP. After a battle, each member loses up to **60 Health** depending on the lowest HP they were taken down to (at half HP: −30; falling: the full 60). Below 100 Health a member is **injured**: they can still go on quests, but **every stat drops by 1/3 of their missing Health** in battle (Health 70 = −10%). Everyone recovers **10 Health a night**. A member whose Health reaches **0 dies** (so an injured member who falls again can die); the main character pulls through at 1 Health instead.
- **Morale** drops for each member who goes on a quest by **1 per turn** of its battle (a 7-turn fight: −7), more if it fails (−10), with injuries (−1 per 5 Health lost), and for everyone when a party member dies (−15). It comes back with **drinks** (a round for the whole party at an inn, once a day: Sleeping Griffin 4 gold a head for +8, Silver Lantern 8 for +12, Gilded Crown 12 for +15) and **days off**. Below **50 Morale**, a companion or slave loses **2 relationship every day**. At **0 Morale** a member **leaves the party** (companions and slaves go to the guild hall; the main character stays).

**In battle**, every stat of a party member drops by **1% per 5 Morale below 100** (Morale 50 = −10%), on top of the injury penalty. Slaves also lose **1% per 5 Obedience below 100**. The penalties multiply: Health 70, Morale 50 and Obedience 60 give 0.9 × 0.9 × 0.92 = −25.5%. New members start at 75 Morale (−5%), so keeping spirits up matters. Manage Party shows each member's total (`combat` in `guild.json`).

**Slaves** have a **relationship** (it moves like a companion's: quests completed together, nights better or worse than they expect, low Morale, missed upkeep) and **Obedience** (0–100). Market slaves start at 40–80 Obedience, registered captives at 0–40, both at 40 relationship. Obedience **rises 1 a day while relationship is 60+** and **falls 1 a day below 40**. **Punish** (Manage Party, once a day per slave) gives **+20 Obedience for −20 relationship**: a quick boost that drains away again unless the relationship is repaired. (`slave` in `guild.json`.)

**Traits** are listed under each adventurer's skills in Manage Party (hover one for what it does). For now there's one: **Protagonist**, which your main character has. It **doubles Health recovery** (20 a night, 40 on Recover) and **doubles Morale gains** (drinks, days off). Morale losses aren't doubled. Traits are defined in `src/data/traits.ts`. In Manage Party, hovering **Health**, **Morale**, **Relationship** or **Obedience** (marked ⓘ) shows a tooltip with how that stat works and where the member stands now.

**The lineup** (Manage Party) is who goes on the next quest: anyone can be benched, your main character too, as long as at least one member goes. Benched members stay in the city and follow their schedule (Recover heals twice as fast), so you can rest an injured main character while the others work. **Drag members up and down the roster** to reorder the party; the lineup follows the same order.

The **schedule** (Manage Party) sets what each member does on days they aren't on a quest. It runs when the day ends; members who went on that day's quest skip it.

| Activity | Effect per day |
|---|---|
| Recover | 2× Health recovery (20 instead of 10) |
| Training | +25 XP |
| Odd Jobs | +10 gold |
| Day Off | +10 Morale |

Unscheduled members recover when injured and take a day off otherwise.

Every 7th day is **payday** for companions.

### Ranks, the leaderboard and quests

**Adventurer ranks** come from level: **D** 1–5, **C** 6–10, **B** 11–15, **A** 16–20, **S** 21+ (`adventurerRanks` in `guild.json`). They're shown next to every adventurer's level.

**Party ranks** (D to S) come from **renown**: **C at 100**, **B at 400**, **A at 1600**, **S at 6400** (`ranks` in `guild.json`). Reaching the next rank's renown posts that rank's **promotion quest** on the Quest Board (gold frame); completing it promotes the party. Renown doesn't fade: completing a quest earns it, **failing a quest loses that quest's renown**, and **each party member who dies loses half of it**. A party that stays **below its rank's renown for a full week drops a rank**. The **Leaderboard** lists every party by rank, then renown. Your party starts at D. Parties hold up to **12 members** and take up to **5** on a quest.

The **Quest Board** is shared with every rival party. It holds up to **40 quests** across all ranks (usually about 25): up to 8 new ones are posted each day by rank weight (C 60, D 40, A 25, B 20, S 1, out of 146: about 41% C, 27% D, 17% A, 14% B, 0.7% S; `board.rankWeights` in `guild.json`), and each stays up 4–8 days. Nothing is held back for you: in a slow week the rivals may snap up every quest at your rank. **Rival parties take quests from it every day**, and they go for the best deals first, so a generous quest may not last. You can take quests at your rank or below (the board shows those by default; **All quests** shows the rest, locked). **Sort** the board by rank (the default, highest first), gold reward, renown, difficulty or enemy type; click the selected sort again to reverse it (▲/▼). The promotion quest always stays on top. The Guild Hall and the Slave Market sort the same way by level (the default, highest first), talent, name or cost (a mercenary's fee, a slave's asking price). Quests vary in risk and reward:

- **Enemy level and group size** are rolled independently within the quest's rank ("Small group" and "Large band" mark the bottom and top third of its size range). Together they make the quest's **total threat**, which sets its pay, renown and how hard rival parties find it.
- **Quest cards** show the foes as pictures rather than numbers: an icon per enemy to expect (a small copy of the monster's battle art; goblins, bandits, skeletons, orcs, sellswords and renegades get their own head badges), and **skulls from ½ to 10, in halves**, for how hard the quest is on one fixed scale for the whole game: ½–5 fill five white skulls, and 5½–10 lay red skulls over them. Skulls rise evenly with the quest's difficulty (the average party level it calls for, from its total threat): half a skull at difficulty −4, ten at 24 (`threat.skulls` in `guild.json`). D quests show about ½–3, C 3–6, B 5½–8, A 7½–10. Hover them for the same in words. The enemy level is in the description, and the card says how long the journey is and the day the notice comes down.
- **Pay**: on top of that, the reward is 0.75–1.35× the usual for the quest's level and group size. Cards flag **Generous pay** and **Poor pay**.

**Total threat** = group size × strength. Group size is in threat points (each enemy type's `threat` in `enemies.json`: a bandit is 1, a rat 0.5, so weak types come in bigger packs). Strength is how strong one enemy is at the quest's level: 10 at level 1, about 16.5% more per level (a level-20 enemy is about 18× a level-1 one). Usual gold is total threat × 1.75 and renown total threat × 0.26; the pay roll then adds luck to the gold. (`quests` and `threat` in `guild.json`.)

| Rank | Enemy levels | Group size | Total threat | Usual gold | Renown |
|---|---|---|---|---|---|
| D | 1–5 | 2–4 | 20–74 | 35–130 | 5–19 |
| C | 6–10 | 3–6 | 64–237 | 110–415 | 17–62 |
| B | 11–15 | 4–7 | 184–594 | 320–1040 | 48–154 |
| A | 16–20 | 5–8 | 494–1456 | 865–2550 | 128–379 |
| S | 21–25 | 4–7 | 848–2735 | 1485–4785 | 221–711 |

Promotion quests use the easier half of the rank's levels, its middle group size and usual pay.

**XP** from a quest: every member who comes back gets **25 XP** (the same as a day of Training) plus an **equal share of 200 XP**, so smaller parties learn faster. Each member's total is then adjusted by the level difference: **+25% per level the enemies are above them, −25% per level below**, and **nothing at 4 or more levels above** (veterans can still escort newcomers on easy quests for the pay, but learn nothing). A **failed quest** pays no reward, but still gives the 25 XP plus the pool's share for the fraction of enemies defeated (killed or surrendered): beating 3 of 4 before falling back is worth 75% of it. (`xp` in `guild.json`.)

**Bounties**: every enemy the party kills is worth a bounty of 9 gold per level (the same as turning in a prisoner), claimed when the party gets back to the city, whether the quest succeeded or not.

| Party size | XP each at the enemies' level |
|---|---|
| 1 | 225 |
| 2 | 125 |
| 3 | 92 |
| 4 | 75 |
| 5 | 65 |

Each level needs **25 XP more than the last**: 100 from level 1 to 2, 125 to 3, 325 from 10 to 11, 575 from 20 to 21 (`xpPerLevel` in `stats.json`). Early levels come after a win or two; later ones take several, or harder quests.

### The other parties

The rival parties are simulated day by day. A new game starts them spread over the ranks (weights S 1, A 5, B 20, C 60, D 40, out of 126: about 0.8% S, 4% A, 16% B, 48% C, 32% D, with at least one A-rank party; `partyRankWeights` in `guild.json`; a rival reaching S is rare, about one in a generation), each made of adventurers of about its rank. Each day a party has a 25% chance of going on a quest. It takes the board quest (at its rank or below) with the best reward for the risk: its chance of success (its level and size against the quest's difficulty: the level at which a group of 4 would have the quest's total threat, minus 1, so a large band or a higher level both make it harder; it won't take anything under 55%) times the gold and renown, minus what a failure would cost. A different party gets first pick each day; if nothing suits it, it rests. Success earns renown and sometimes a level (less often at high levels). With enough renown, a party takes its promotion quest once it has at least an even chance. Failure costs renown and can cost members (they die or quit), and a badly outmatched party can be **wiped out** and removed. Experience keeps adventurers alive: a member's chance of being lost is ×0.88 per level above 1 (at least ×0.1, so a level-18 veteran is about 10× less likely to die than a recruit), and wipes scale the same way with the party's average level. Parties only recruit adventurers within 4 levels of their average (anyone once they're down to 2), so A-rank parties stay A-rank strength. Parties of one break up, and the survivor goes back to the guild hall. New adventurers (mostly fresh recruits, now and then a veteran) arrive at about the rate adventurers are lost, nudged toward 100. When the hall gets crowded (or there are fewer than usual parties), they band together as a **new D-rank party**. **Guild News** reports all of this.

### Party members

| Type | How you get them | Cost | Notes |
|---|---|---|---|
| **Main character** | Created at the start | Food & lodging | Permanent; can be benched to stay in the city while others quest |
| **Mercenary** | Guild Hall | The **larger** of a fixed fee and a % of the next quest's reward: the fee up front, and if their cut of a won quest is worth more, they take the difference from the reward | Leaves after the next quest, win or lose |
| **Companion** | Guild Hall, after negotiating a contract | Base pay every 7th day, a % of each reward, food & lodging if included | Permanent while the contract runs |
| **Slave** | Slave Market, or a prisoner registered at the city gate | Food & lodging, plus a weekly property tax (5% of their market value) | Permanent; can be sold to the market; seized by the city if the tax goes unpaid |

**Companion contracts** have four terms: **base pay**, **loot cut** (% of each quest reward), **food and lodging included** (worth to them what the food and night their rank expects would cost you: 14 gold a week for D-rank, 112 for C-rank, 336 for B-rank, 1,008 for A and S-rank), and **term length** (2, 4, 8 or 12 weeks). Candidates ask more the higher their level and the greedier they are, a little more for short terms and less for long ones. They value a loot cut by what a party of your rank usually earns (150 gold a week at D, 2000 at A, 4500 at S). An offer close to what they want gets a counter-offer; a low one offends them. Each rejected offer uses up patience, and once it runs out they won't talk to you for a week.

Companions (and slaves, see above) have a **relationship** score (0–100). It goes up by 6 for every quest completed together, drops if you can't pay them, and lowers their demands when you renew: by up to 30% at 100. When a contract ends, they sit out of quests and you have 3 days to **renew** it (Manage Party) before they leave. Walking out of a renewal ends the contract on the spot. Unpaid companions lose 20 relationship each payday, and quit when it reaches 0.

**Prisoners**: human enemies who surrender in battle are taken prisoner when you win, as many as surrender. The party doesn't keep prisoners: when it comes back, the **city gate** won't let them in until each one is registered, either **turned in for a bounty** (9 gold per level) or **registered as your slave** (only while the party has room) for a fee of its normal market value minus its bounty, so at an average market both come to the same: a level-6 prisoner with average talent is worth 470 gold, so its bounty is 54 and its fee 415. **Slaves are taxed** every payday (every 7th day, with companion wages) 5% of their normal market value (24 gold a week for that level-6 slave; `slave.weeklyTaxShare` in `guild.json`). If you can't pay a slave's tax, the city **seizes** them and sells them at the slave market. **Turn them all in** settles them at once.

**The Slave Market** is a living market (`market` in `guild.json`). It holds **10–30 slaves**: a few (1–4) are sold to other buyers every day, and a **shipment of 5–12 arrives twice a week** (days 1 and 4 of each week; the screen shows the next one). Slaves are of about your party's rank. **Prices follow supply and demand**: each slave's value (120 gold + 70 per level above 1, × talent) times a price index that drifts a little every day and rises when stock is short (falls when there's a glut), between 70% and 150% of usual. The market buys your slaves for **80%** of the current price (Slave Market or Manage Party). It doesn't buy prisoners.

All of these numbers are in `src/data/guild.json`.

### Editing the game data

Everything gameplay-related lives in plain JSON files in `src/data/`. Each file is checked when the game loads, and a mistake fails with a message naming the exact field (e.g. `skills.json: "skills.kick.tags[3]" "flying" is not defined in "tags"`).

| File | What's in it |
|---|---|
| `stats.json` | Base stats and per-level growth, talent grades (growth rates and roll weights), Defense scaling, terrain movement costs, forest bonus, map size, vision switch |
| `skills.json` | Every skill (numbers and descriptions), tags, status effects (Burn, Slow), skill trees |
| `weapons.json` | Weapons: stat multipliers and granted skills |
| `enemies.json` | Enemy types: level range, stats, skills, art, and how big encounters are |
| `guild.json` | Arch City: starting gold, rank shares, quest rewards, upkeep, mercenary and companion pay, slave prices, and the rival-party simulation |

Tooltips show a formula line generated from the numbers (e.g. "80% P.Atk, then 40% P.Atk + 100% Def"), so it stays correct even if a description is out of date.

### Stats

| Stat | Default | Meaning |
|---|---|---|
| Health | 500 (+50/level) | Max health |
| Mana | 200 (+20) | Spent by skills; doesn't come back during a battle |
| P.Atk | 100 (+10) | Physical power; skills deal a % of it |
| M.Atk | 100 (+10) | Magic power and healing |
| Defense | 0 (+10) | Damage taken × 100 / (100 + Defense) |
| Resist | 0 (+10) | Chance to shrug off a debuff: Resist ÷ (100 + Resist) |
| Movement | 16 | Movement points per turn: grass costs 4, forest 6, river 8 (so 16 = 4 grass tiles) |

Every attack hits. **Resist** gives a chance to shrug off debuffs (Burn, Slow, Corrode...): Resist ÷ (100 + Resist), the same curve as Defense, so 50 Resist = 33% and 100 = 50%. A resisted debuff shows "Resisted" and doesn't apply; the attack's damage still lands. Targeting shows the chance, and the enemy AI weighs it. Enemies' Resist matches their Defense.

Stats grow automatically on level up (100 XP for the first level, 25 more for each one after), at a speed set by the Adventurer's **talent**. Every growing stat (Health, Mana, P.Atk, M.Atk, Defense, Resist) has its own talent grade, rolled when the Adventurer is created; the grade multiplies that stat's growth per level (the numbers in brackets above):

| Talent | S | A | B | C | D | F |
|---|---|---|---|---|---|---|
| Growth | 160% | 140% | 120% | 100% | 80% | 60% |
| Chance | 5% | 10% | 20% | 40% | 20% | 5% |

An S-talent P.Atk grows +16 a level instead of +10. Talent doesn't change level-1 stats. An Adventurer's overall talent is the grade nearest the average of their six, with a **+** or **−** when the average sits in the upper or lower third of that grade's band (so **A+** is close to S and **S−** just short of all-S; S never gets a + and F never a −). When you create your main character, or create or customize a Quick Battle recruit, **Reroll talent** rolls new grades, and the **‹ ›** arrows beside each grade set it by hand (F to S). Party members in the campaign keep the talent they have. Talented Adventurers cost more: mercenary fees and cuts, companion wages and slave prices are multiplied by `1 + 2 × (average growth rate − 1)` (at least ×0.4; `talentPrice` in `guild.json`), so all-S costs ×2.2 and all-F ×0.4. Growth rates and roll weights are in `stats.json` (`talent`): a grade's chance is its weight divided by the total of all weights, so the weights can be any non-negative numbers (a grade with weight 0 never comes up). Enemies always grow at 100%.

A won quest gives each member in the lineup `xpPerVictory` (100, in `stats.json`) when their level equals the quest's stage, more when they're below it and less when above, so a party that keeps winning stays close to the level of the quests it takes.

Weapons **multiply** these stats:

| Weapon | Multipliers | Skills (the first is the basic attack) |
|---|---|---|
| Sword & Shield | x1 P.Atk, x0.8 M.Atk, x1.25 Def | Sword Slash, Shield Up |
| Spear | x1 P.Atk, x0.8 M.Atk | Spear Thrust |
| Bow | x1 P.Atk, x0.8 M.Atk, x0.8 Def, range 5 | Bow Attack (by mode), Switch Mode |
| Staff | x0.6 P.Atk, x1.2 M.Atk, x0.8 Def | Empowered Strike, Magic Bolt |

### Action points and mana

Every unit gets **2 AP** each turn: a **movement AP** (the regular move) and an **action AP**. Each skill has an AP cost (`ap` in `skills.json`):

| Cost | Effect |
|---|---|
| 0 (free) | No AP. Usable until the unit's turn ends (Kick, Engage). |
| 1 AP | Uses the movement AP if it's still unspent, otherwise the action AP. The turn goes on while AP remain. |
| 2 AP | Uses both AP (so it can't follow a move). The turn goes on: free actions are still allowed. |
| Ends turn | Uses all remaining AP and ends the unit's turn. The default: every weapon and tree skill, and Overwatch. |

Moving after a skill isn't possible once the movement AP is gone. **Undo move** takes back a regular move as long as nothing else happened since: once that unit uses a skill, takes an Overwatch shot, or another unit on your team moves or acts, the move is locked in.

Skills can cost **mana** (`mana` in `skills.json`), which doesn't come back during a battle: Engage 10, Kick 10, Arcane Weapon 10 (toggle), Charge 20, Cleanse 20, Dash 20, Double Strike 20, Execute 20, Pocket Sand 20, Arcane Bolt 30, Freeze 30, Ignite 30, Arcane Shift 40, Barrier 40, Fireball 40, Flicker Strike 40, Heal 40, Iceblast 40, Life-Risking Strike 40, Protection 40, Shadow Step 40, Circle Swing 50, Arcane Pulse 60, Firestorm 100, Blizzard 100. Skill buttons show the cost; without enough mana a skill is greyed out. In battle, units with mana have a blue **mana bar** under their HP bar.

**Bow modes**: the bow's basic attack depends on its mode. **Switch Mode** (a free action) cycles Direct → Indirect → Melee → Direct. The bow keeps the selected mode between battles (saved as `weaponMode` on the character). Overwatch, opportunity attacks and Weapon skills (Execute, Double Strike) use the current mode. Circle Swing always swings in Melee mode without changing the selection. Bow Strike (Melee) engages, and a bow user that is engaged always fights in Melee mode; its selected mode comes back once it breaks free. Enemy archers fight at range: each turn they pick Direct or Indirect, whichever gives the better attack (Indirect when cover is in the way), and only fight in Melee when engaged. Modes are set in `skills.json` (`bow_attack.modes`), with ranges relative to the weapon's `range` in `weapons.json`.

| Mode | Skill | Range | Damage |
|---|---|---|---|
| Direct | Direct Shot | Weapon range (5), needs line of sight | 100% P.Atk |
| Indirect | Indirect Shot | Weapon range x 1.5 (7.5), arcs over cover | 70% P.Atk |
| Melee | Bow Strike | 1.5 | 80% P.Atk |

**Damage types**: every hit is split by what it scales with. P.Atk, Defense and missing Health deal **Physical** damage (red numbers); M.Atk deals **Magical** damage (violet numbers), so a hybrid hit like Magic Bolt shows one of each. Both are reduced by Defense for now; `Battle.mitigation` is where magic resistance and physical / magic penetration will go. Skills are tagged Physical / Magical to match their hits (a test checks this).

**Basic abilities** (every Adventurer, listed under the weapon in the creator):

- **Dash** (1 AP, 20 MP, cooldown 1): only after the regular move. Spends the action AP to move again, up to your Movement. Overwatch can still fire on the way; it can't be undone.
- **Overwatch** (ends turn): watch a 60° arc in any direction, as far as your weapon reaches (Bow 5 in Direct mode, 7.5 in Indirect, 1.5 in Melee; Spear 2; sword and staff 1.5). The first enemy to move into it takes your basic attack and keeps moving. Bow and Spear no longer have their own Overwatch / Intercept.

### Skill points, skill trees and the Body tab

Adventurers have **skill points**: 2 at level 1 and 1 more every level. Each point either learns a skill-tree skill (mix trees freely) or goes into the **Body** tab, where it trains a stat by twice its base growth per level: +100 Health, +40 Mana, +20 P.Atk or M.Atk, +20 Defense or Resist per point (before weapon multipliers; talent doesn't change it). Each stat takes at most **level / 3 (rounded up)** points: 1 up to level 3, 2 up to level 6, and so on; a loaded save over the cap gets the extra points back. Points can be moved around freely in Customize / Loadout.


Some skills need a **minimum level** (`level` in `skills.json`; shown as "Lv 3" in the skill tree). Until then they're greyed out and can't be learned. A loaded save with a skill above the character's level unlearns it and refunds the point. Random adventurers only pick skills their level has unlocked.

- **Mage**: Arcanist (Arcane Bolt, Arcane Pulse Lv 3, Arcane Shift Lv 3, Arcane Weapon Lv 3), Elementalist (Ignite, Freeze, Fireball Lv 3, Iceblast Lv 3, Firestorm Lv 5, Blizzard Lv 5), Cleric (Heal, Cleanse, Protection Lv 3, Barrier Lv 3)
  - **Ignite** / **Freeze** (1 AP, 30 mana, 1-turn cooldown): 20% M.Atk and a stack of Burn / Slow. **Fireball** / **Iceblast** (level 3): 120% M.Atk and a stack of Burn / Slow.
  - **Arcane Weapon** is a **toggle** (free action): switching it on costs 10 mana, and keeping it on costs nothing. While it's on, every weapon attack (basic attacks, Overwatch, opportunity attacks and Weapon skills such as Double Strike, Execute and Circle Swing) deals an extra 50% M.Atk Magical hit each time it hits, for **10 mana per hit**: Double Strike pays twice, Circle Swing once per target it hits. Mana never goes below 0: a hit you can't pay for gets no extra damage, and Arcane Weapon switches off. Using it again switches it off for free. The skill bar shows it as **ON**, and damage previews include the extra hit.
- **Warrior**: Vanguard (Engage, Charge Lv 3), Infighter (Kick, Pocket Sand Lv 3), Assassin (Shadow Step, Flicker Strike Lv 3, Life-Risking Strike Lv 5), Weapon Master (Double Strike, Execute Lv 3, Circle Swing Lv 5)

Status effects: **Burn** and **Slow** don't last a set number of turns: skills apply **stacks**, and the unit loses one stack each turn. **Burn** deals 5% of max Health per stack at the end of the burning unit's turn (reduced by Defense and absorbed by shields, like a hit), then drops a stack, so the unit (and its team, e.g. with Cleanse) gets to act first; it holds up to 2 stacks, and a 3rd stack **Explodes**: Burn is removed and the unit takes 15% of its max Health at once (also reduced by Defense and shields). **Slow** is −4 Movement per stack and drops a stack at the end of each turn; up to 2 stacks, and a 3rd Freezes the unit for one turn (it can't move and loses its movement AP; Frozen wears off at the end of that turn, so if it happens mid-walk, it's that same turn). Slow and Frozen count down before end-of-turn zone hits, so Slow stacks picked up by ending a turn in a Blizzard last into the next turn. Also Corrode, Frenzy, **Blinded** (Pocket Sand: −30% P.Atk and M.Atk), **Exposed** (Life-Risking Strike: no Defense until your next turn) and **Stealthed** (Shadow Step: enemies can't target you directly or trigger overwatch on you until your next turn; area attacks still hit, and attacking ends it).

### Tags

Every skill has tags that explain how it behaves. These five change the rules:

- **Movement**: range in tiles = rangeScale × Movement ÷ 4 (the grass cost), rounded down. Charge uses 100% (4 tiles at Movement 16), and Slow (−4 Movement) shortens it. Arcane Shift has a fixed range of 2.
- **Weapon**: uses your weapon's basic-attack range and line rules (Execute with a Bow reaches 5 tiles). Double Strike hits with the basic attack twice (the second hit at 50% damage), and Circle Swing hits every unit within the weapon's range with it, allies included (a bow uses its Melee mode for both the reach and the hit). Unusable while the weapon is disabled (nothing disables weapons yet).
- **Engage**: see below. Sword Slash, Bow Strike (bow in Melee mode), Empowered Strike, Engage, Kick, Charge, Flicker Strike, Life-Risking Strike.
- **Disengage**: usable while engaged, on anyone, and it ends your engagement with no free attack for your opponent. Arcane Shift, Shadow Step.
- **Free Action**: costs 0 AP (Kick, Engage). Usable any time until the unit's turn ends, so after a move or a 1/2-AP skill, but not after a turn-ending one. The turn doesn't end automatically while a unit still has a free action with a target in reach; press **End Turn** when done.

Descriptive tags: Melee, Physical, Magical, Projectile, Indirect, Area, Knockback, Reaction, Teleport, Stealth, Debuff, Support.

### Enemies

Each enemy type has a fixed level range and its own stats and skills (`src/data/enemies.json`). A quest picks one **main foe** whose range contains the quest's level; other fitting types that fight the same way can join it (wolves with spiders, bandits with sellswords, skeletons with wraiths). Its name sets the quest's title.

| Type | Levels | Fights as | Skills |
|---|---|---|---|
| Giant Rat | 1–2 | Beast | Gnaw. Fast and weak; comes in packs. |
| Green Slime | 2–3 | Beast | Slam (Engage); Sticky Spit at level 3 (ranged Slow and Corrode). |
| Grey Wolf | 3–6 | Beast | Bite (Engage), Pounce (leaps in); Howl at level 4 (Frenzy for nearby allies). |
| Goblin | 3–7 | Tribal | Spearmen, archers and shamans (Fireball); War Cry at level 5. Small and many. |
| Bandit | 4–8 | Human | A random weapon, basic attack only; Thugs Shield Up, Hexers Fireball, Archers Execute; Kick at level 5. |
| Giant Spider | 5–9 | Beast | Poison Bite (Engage, Poison: 3% max HP per stack each turn), Web (ranged Slow). |
| Skeleton | 6–11 | Evil | Warriors, spearmen and archers; basic attacks only. |
| Orc | 7–13 | Tribal | Warriors and brutes with Cleave (hits everyone adjacent); War Cry at level 9. |
| Sellsword | 8–14 | Human | Full weapon kits plus Kick, Charge, Execute, or Fireball and Heal (Hedge Mages). |
| Cave Bear | 9–14 | Beast | Maul (Engage), Rend (heavy hit); Roar at level 12 (Blinds nearby enemies). |
| Wraith | 10–16 | Evil | Spectral Touch (magic, Engage), Chill Touch (also a stack of Slow; 1-turn cooldown), Wail (hurts and Blinds everyone nearby). |
| Troll | 13–20 | Tribal | Club (Engage), Smash (knockback), Regenerate (heals itself). Slow and huge. |
| Renegade | 14–25 | Human | Knights, lancers, rangers and sorcerers with Double Strike, Circle Swing, Freeze, Heal... |
| Wyvern | 15–23 | Beast | Bite (Engage), Dive (swoops in), Tail Sting (Poison x2). Very fast. |
| Demon | 16–25 | Evil | Claw (Engage), Hellfire (ranged, 2 stacks of Burn), Infernal Leap. |

**Enemy AI** has four temperaments (`ai` in `enemies.json`):

- **Beast**: acts alone. It only ever goes for the **nearest** target (never the weakest), barely weighs danger, and **flees** once below 40% health.
- **Tribal**: fights as a group. Members keep a **loose formation** (no more than 3 tiles from the next one, without bunching up), so a fighter that's out ahead waits for the others, and they pile onto targets their friends are already on. Once **half the group is gone** (and they aren't outnumbering the party) or the survivors are badly hurt, **the whole group runs**, even the unhurt.
- **Human**: fights tactically: cover, danger, picking off the weak, falling back to regroup with healthy allies. It **flees** when badly hurt (below 35%) or hurt and in reach of a killing blow, but only once its side is losing or it's on its own: while it has allies standing and its side's strength (total HP × total attack) is at least half of yours, it **holds firm** and falls back to its friends instead. If it can't reach the edge this turn and every tile it could get to is in reach of enough damage to kill it, it **surrenders**. Surrendered enemies are taken **prisoner** if you win (only humans can be): register them at the city gate for a bounty or as slaves.
- **Evil** (spirits and demons): no self-preservation. It **never flees or disengages**, ignores danger and barely cares about hitting its own side, and goes for **kills**: hurt targets are worth more to it, finishing one off most of all.

Fleeing enemies run for the nearest map edge and escape once they reach it. An engaged enemy only breaks away (and takes the opportunity attack) if the turn it would then play ends out of its opponent's reach: not while Frozen, not when every tile it could reach is still next to its opponent, and not when it would rather stay and fight from where it stands anyway. Ranged enemies (bows and spears) step back before they shoot rather than end their turn next to a foe that could engage them. Buffs such as Howl and War Cry are weighed by the extra damage they let allies deal (or save them from) on the turns they actually last, counting only allies with a foe in reach, so an enemy only stops attacking to rouse its pack when the pack is about to fight. Healthy beasts, tribals and humans take small risks freely, and danger they can't avoid anyway doesn't hold them back; wounded humans and tribals may hold back from walking into a deadly spot, but never for more than two turns in a row.

Encounter size comes from the quest, never from your party: its rolled group size (**D 2–4, C 3–6, B 4–7, A 5–8** threat points; `quests.<rank>.count` in `guild.json`). Each enemy uses its type's threat: rats 0.5, goblins 0.6, bandits 1, demons 2... so a group of 4 is 4 bandits or 8 rats (at most 12 enemies on the field). A lone adventurer meets as many enemies as a full lineup. Quick Battle stages use the middle D group (3). Past level 25, the toughest types keep coming at level 25 and the group grows 25% per level. Hover an enemy in battle to see its skills. **Click an enemy** to see its reach on its next turn: the tiles it can move to (orange) and, around them, every tile its longest-ranged attack that will be off cooldown can hit (red). Click it again, or anywhere else, to hide it.

### Engagement

Hitting a unit with an **Engage** skill (or **Spear Thrust** on an adjacent target, diagonals included) locks you both together, unless the target is already engaged with someone else. While engaged:
- You can't move, you can only attack your opponent, and you can only heal or cleanse yourself.
  - Attacks are fine as long as they hit your opponent: Spear Thrust aimed through them (diagonals included), Circle Swing (even if it also catches others), and Charge on the opponent itself (no dash, just the strike).
- **Disengage** (button in the battle sidebar) breaks free, but your opponent gets a free basic attack on you (an opportunity attack). You can then move and act normally.
- **Disengage** skills (Arcane Shift, Shadow Step) slip out of an engagement with no opportunity attack. **Arcane Pulse** isn't one: an engaged caster can only Pulse its own opponent, and pushing it away breaks the engagement and gives the caster the free hit. Other teleports and moves need you to disengage first.
- Engagement also ends if either unit falls, or if either one is successfully pushed by a knockback (Circle Swing, Arcane Pulse), even if they still end up next to each other. The pushed unit takes a free basic attack from its old opponent, just like disengaging. A push that's blocked doesn't break it.

Cleric skills (Heal, Cleanse, Protection, Barrier) work only on your own side, yourself included. An attack aimed straight at an ally hits them normally (lines like Spear Thrust pass by allies they aren't aimed at). In battle, the game asks for confirmation before you attack an empty tile or an ally. The battle log keeps the whole fight: scroll it with the mouse wheel or the bar on its right.

### Lines, cooldowns, and prepared systems

- *Line of sight* (no rock in between): Direct Shot (bow in Direct mode), Magic Bolt, Arcane Bolt, Arcane Pulse, Fireball, Iceblast, and Overwatch with a weapon that needs it (Bow).
- *Line of fire* (no rock **or unit** in between): no skill uses it right now; set `"los": "fire"` on a skill to use it.
- No line needed: melee skills, Spear Thrust (it stops at the first enemy in the way), Indirect Shot (bow in Indirect mode), Ignite, Freeze, Heal, Cleanse, Arcane Shift.
- **Ranges** use Euclidean distance. Ranges of 2 or more round the distance to the nearest tile, so range 2 also reaches 2-over-1-up and shapes are rounder. Ranges 1 and 1.5 stay exact: 1 is the 4 neighbours, 1.5 adds the diagonals. Set `rangeRounding.fromRange` in `stats.json` to change the cut-off.
- Skill tooltips and the weapon panel show a **tile diagram** of what each skill covers, with you in gold, rather than describing range in words.
- A cooldown of N means the skill can't be used during your next N turns.
- `vision` (fog of war) is built but switched off in `stats.json`.

### Art

Adventurers have a **custom look**: sex (male or female), skin (pale, light, fair, olive, light brown, brown), one of 4 faces per sex, a hairstyle (men: crew cut, bowl cut, permed, tied; women: bob cut, ponytail, crown braid, down with bangs, braided, bun) and a hair colour. Their outfit follows their weapon (armour, tunic or robe) in their chosen colour. Looks are drawn in the browser on first use by `src/art/unitArt.js`, so every combination stays sharp without hundreds of files.

They're drawn in a storybook style (no outlines, simple dot eyes, muted watercolour colours, light paper texture, about 5 heads tall). The static sprites are 8 body models (`m1`–`f4`, available to human enemy types) 4 bandit models (`b1`–`b4`) and 6 other humanoid foes (goblins `g1`/`g2` with pointy ears, orcs `o1`/`o2` with tusks, skeletons `s1`/`s2` with empty glowing sockets), each drawn holding each weapon since the pose depends on the weapon: `public/art/units/<model>_<weapon>.svg`, 72 SVGs that stay sharp at 4K. Monsters are `public/art/monsters/<kind>.svg` (rat, slime, wolf, spider, bear, troll, wraith, wyvern, demon) on a wider 96×80 canvas, coloured from `art.color` in `enemies.json`; enemy types choose their body models with `art.models`. They're generated by `node tools/generate-art.mjs` from the shared drawing code in `src/art/unitArt.js`: edit the colours, hair, outfits or proportions there and re-run it, or replace the SVGs with your own art (same 64×80 canvas, or 96×80 for monsters, feet at y = 76).

## Save files

Saves are **pretty-printed JSON**. You can save to 3 browser slots, or Export a `.json` file and Import it later. Hand edits are validated, with errors that name the exact field (e.g. `party[0].appearance.look.hair must be one of: bobCut, ponytail, ...`). Older saves are upgraded automatically: the first party member becomes your main character, the others companions on a 4-week contract, and the party joins the guild with renown and gold for the stages it had cleared.

A version-3 save holds the whole city: the day, gold, renown and rank, your party with each member's contract, the lineup, the accepted quest, the guild (rival parties, free adventurers in the hall, the quest board, news), the slave market, food choices and any prisoners waiting at the gate. A party member looks like this:

```json
{
  "id": "c_3268ddub",
  "name": "Brienne",
  "level": 2,
  "xp": 75,
  "weaponId": "staff",
  "skillIds": ["fireball", "heal"],
  "appearance": {
    "color": "#3d7be0",
    "look": { "sex": "female", "skin": "fair", "face": 2, "hair": "crownBraid", "hairColor": "auburn" }
  },
  "talents": { "health": "B", "mana": "C", "pAtk": "D", "mAtk": "A", "defense": "C", "resist": "B" },
  "contract": {
    "type": "companion",
    "basePay": 60,
    "lootPct": 5,
    "foodLodging": true,
    "termWeeks": 4,
    "startDay": 3,
    "endDay": 31,
    "relationship": 22,
    "greed": 1.05
  }
}
```

The main character also has `"traits": ["protagonist"]` (older saves get it on load).

## Development

```bash
npm install
npm run dev      # local dev server with hot reload
npm test         # rules, save-file and AI tests (Vitest)
npm run build    # type-check + production build into dist/
```

## Project layout

```
src/
  data/       stats.json, skills.json, weapons.json, enemies.json, guild.json (editable game data) + loaders/validation
public/art/   unit SVGs (one per body model and weapon) and monster SVGs (tools/generate-art.mjs regenerates them)
  art/        unitArt.js: draws units as SVG (used by the game for custom looks and by tools/generate-art.mjs)
  game/       pure game logic, no Phaser: character stats, battle rules, AI, map generation, save/load,
              Arch City (city.ts), the guild simulation (guild.ts), contracts (contracts.ts), random people (people.ts)
  scenes/     Phaser scenes: MainMenu, SaveLoad, CharacterCreator, City, Guild, Negotiate, Market, Inn, Estate, Party, DemoCamp, Battle
  ui/         small UI helpers (buttons, panels, tokens, dialogs)
tests/        Vitest tests for the game logic and the city simulation
```

The rules in `src/game/` don't depend on Phaser. That keeps them easy to test, and the AI and balance can be simulated quickly.

## Publishing on GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys the game on every push to `main`.
One-time setup: open the repo on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
The game will then be live at `https://<your-username>.github.io/<repo-name>/`.
