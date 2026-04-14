import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Message,
  GuildMember,
} from "discord.js";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error("DISCORD_BOT_TOKEN is not set!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Warnungen pro User tracken (Link-Schutz)
const userWarnings = new Map<string, number>();

// Rollen die /teamwarn und /ban ausführen dürfen
const ERLAUBTE_ROLLEN = [
  "» Projektinhaber",
  "» Projektleitung",
  "» Stv.Projektleitung",
  "» Management",
  "» Teamleitung",
  "Stv.Teamleitung",
];

function hatErlaubteRolle(member: GuildMember): boolean {
  return ERLAUBTE_ROLLEN.some((rollenName) =>
    member.roles.cache.some((r) => r.name === rollenName)
  );
}

// URL-Regex
const URL_REGEX =
  /(?:https?:\/\/|www\.)\S+|discord\.gg\/\S+|discord\.com\/invite\/\S+/gi;

function isMedalLink(url: string): boolean {
  return url.includes("medal.tv") || url.includes("medal.gg");
}

function containsForbiddenLink(content: string): boolean {
  const matches = content.match(URL_REGEX);
  if (!matches) return false;
  return matches.some((url) => !isMedalLink(url));
}

// Stichwort der Kategorie pro Rolle (für flexible Suche)
const HAUPT_ROLLEN_KEYWORDS: Record<string, string> = {
  "» Teamleitung":             "Teamleitung",
  "Stv.Teamleitung":           "Teamleitung",
  "» Admin":                   "Admin",
  "» Test Admin":              "Admin",
  "» Fraktionsverwaltung":     "Verwaltung",
  "» Stv.Fraktionsverwaltung": "Verwaltung",
  "» Communityverwaltung":     "Verwaltung",
  "» Socialverwaltung":        "Verwaltung",
  "» Head Moderator":          "Mod",
  "» Moderator":               "Mod",
  "» Test Moderator":          "Mod",
  "» Supporter":               "Support",
  "» Test Supporter":          "Support",
  "» Mitglied":                "Mitglied",
};

// Hauptrolle suchen: flexibel — findet jede Rolle die 💎 und das Stichwort im Namen hat
function findeHauptRolle(guild: GuildMember["guild"], keyword: string) {
  return guild.roles.cache.find(
    (r) =>
      r.name.includes(keyword) &&
      (r.name.includes("💎") || r.name.includes("💙") || r.name.includes("❤") || r.name.includes("🔷"))
  ) ?? null;
}

async function vergebeHauptrolle(member: GuildMember, rollenName: string): Promise<string | null> {
  const keyword = HAUPT_ROLLEN_KEYWORDS[rollenName];
  if (!keyword) return null;

  const hauptRolle = findeHauptRolle(member.guild, keyword);

  if (!hauptRolle) {
    console.warn(`Keine Hauptrolle mit Stichwort "${keyword}" und Emoji gefunden!`);
    const matches = member.guild.roles.cache.filter((r) => r.name.toLowerCase().includes(keyword.toLowerCase()));
    matches.forEach((r) => console.log(`  Gefundene Rolle mit Stichwort: "${r.name}"`));
    return null;
  }

  const hatHauptRolle = member.roles.cache.has(hauptRolle.id);
  if (hatHauptRolle) return hauptRolle.name;

  try {
    await member.roles.add(hauptRolle);
    console.log(`Hauptrolle "${hauptRolle.name}" an ${member.user.tag} vergeben.`);
    return hauptRolle.name;
  } catch (err) {
    console.error(`Fehler beim Vergeben der Hauptrolle "${hauptRolle.name}":`, err);
    return null;
  }
}

// Alte Hauptrolle entfernen (beim Uprank/Derank)
async function entferneHauptrolle(member: GuildMember, rollenName: string): Promise<void> {
  const keyword = HAUPT_ROLLEN_KEYWORDS[rollenName];
  if (!keyword) return;

  const hauptRolle = findeHauptRolle(member.guild, keyword);
  if (!hauptRolle) return;

  // Nur entfernen wenn der Member sie hat
  if (!member.roles.cache.has(hauptRolle.id)) return;

  // Prüfen ob eine andere Rolle aus dieser Kategorie noch aktiv ist
  // (z.B. hat jemand » Admin UND » Test Admin → Hauptrolle soll bleiben)
  const andereKategorieRolle = Object.entries(HAUPT_ROLLEN_KEYWORDS).some(
    ([rName, kw]) => kw === keyword && rName !== rollenName && member.roles.cache.some((r) => r.name === rName)
  );
  if (andereKategorieRolle) return;

  try {
    await member.roles.remove(hauptRolle);
    console.log(`Alte Hauptrolle "${hauptRolle.name}" von ${member.user.tag} entfernt.`);
  } catch (err) {
    console.error(`Fehler beim Entfernen der Hauptrolle "${hauptRolle.name}":`, err);
  }
}

// Rollen für /bewerbung (ohne » Mitglied)
const BEWERBUNG_ROLLEN = [
  "» Teamleitung",
  "Stv.Teamleitung",
  "» Admin",
  "» Test Admin",
  "» Fraktionsverwaltung",
  "» Stv.Fraktionsverwaltung",
  "» Communityverwaltung",
  "» Socialverwaltung",
  "» Head Moderator",
  "» Moderator",
  "» Test Moderator",
  "» Supporter",
  "» Test Supporter",
];

// Rollen für /uprank und /derank
const RANK_ROLLEN = [
  "» Teamleitung",
  "Stv.Teamleitung",
  "» Admin",
  "» Test Admin",
  "» Fraktionsverwaltung",
  "» Stv.Fraktionsverwaltung",
  "» Communityverwaltung",
  "» Socialverwaltung",
  "» Head Moderator",
  "» Moderator",
  "» Test Moderator",
  "» Supporter",
  "» Test Supporter",
  "» Mitglied",
];

const commands = [
  new SlashCommandBuilder()
    .setName("bewerbung")
    .setDescription("Bewerbung eines Users annehmen oder ablehnen")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Der User, dessen Bewerbung bearbeitet wird")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("entscheidung")
        .setDescription("Angenommen oder Abgelehnt")
        .setRequired(true)
        .addChoices(
          { name: "Angenommen", value: "angenommen" },
          { name: "Abgelehnt", value: "abgelehnt" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("rolle")
        .setDescription("Die Rolle, die bei Annahme vergeben wird")
        .setRequired(false)
        .addChoices(...BEWERBUNG_ROLLEN.map((name) => ({ name, value: name })))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("uprank")
    .setDescription("Einen User hochranken")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Der User, der hochgerankt wird")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("von")
        .setDescription("Die aktuelle Rolle des Users")
        .setRequired(true)
        .addChoices(...RANK_ROLLEN.map((name) => ({ name, value: name })))
    )
    .addStringOption((option) =>
      option
        .setName("zu")
        .setDescription("Die neue Rolle des Users")
        .setRequired(true)
        .addChoices(...RANK_ROLLEN.map((name) => ({ name, value: name })))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("derank")
    .setDescription("Einen User deranken")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Der User, der gederankt wird")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("von")
        .setDescription("Die aktuelle Rolle des Users")
        .setRequired(true)
        .addChoices(...RANK_ROLLEN.map((name) => ({ name, value: name })))
    )
    .addStringOption((option) =>
      option
        .setName("zu")
        .setDescription("Die neue Rolle des Users")
        .setRequired(true)
        .addChoices(...RANK_ROLLEN.map((name) => ({ name, value: name })))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("setup-verify")
    .setDescription("Sendet die Verifizierungs-Nachricht in diesen Kanal")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("teamwarn")
    .setDescription("Gibt einem Teammitglied eine Teamwarnung")
    .addUserOption((o) =>
      o.setName("user").setDescription("Das Teammitglied").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("dauer")
        .setDescription("Art der Warnung")
        .setRequired(true)
        .addChoices(
          { name: "Normal", value: "normal" },
          { name: "Dauerhaft", value: "dauerhaft" }
        )
    )
    .addStringOption((o) =>
      o.setName("grund").setDescription("Grund der Warnung").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannt einen User vom Server")
    .addUserOption((o) =>
      o.setName("user").setDescription("Der User der gebannt wird").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("grund").setDescription("Grund des Banns").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("ankündigung")
    .setDescription("Sendet eine Ankündigung mit @everyone in diesen Kanal")
    .addStringOption((o) =>
      o.setName("text").setDescription("Der Text der Ankündigung").setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("teamkick")
    .setDescription("Entfernt alle Rollen eines Teammitglieds (außer Mitglied-Rollen)")
    .addUserOption((o) =>
      o.setName("user").setDescription("Das Teammitglied").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("grund").setDescription("Grund des Teamkicks").setRequired(true)
    )
    .toJSON(),
];

client.once("clientReady", async () => {
  console.log(`Bot ist online als ${client.user?.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(Routes.applicationCommands(client.user!.id), {
      body: commands,
    });
    console.log("Slash-Commands erfolgreich registriert!");
  } catch (error) {
    console.error("Fehler beim Registrieren der Commands:", error);
  }
});

// Link-Schutz
client.on("messageCreate", async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  const member = message.member;
  if (!member) return;

  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  if (!containsForbiddenLink(message.content)) return;

  // Nachricht SOFORT löschen
  try { await message.delete(); } catch {}

  const guild = message.guild;
  const userId = message.author.id;
  const warnings = (userWarnings.get(userId) ?? 0) + 1;
  userWarnings.set(userId, warnings);

  if (warnings === 1) {
    const warnRole = guild.roles.cache.find((r) => r.name === "Warn 1");

    try { await member.timeout(60 * 60 * 1000, "Link ohne Erlaubnis gesendet"); }
    catch (err) { console.error("Fehler beim Timeout:", err); }

    if (warnRole) {
      try { await member.roles.add(warnRole); }
      catch (err) { console.error("Fehler beim Vergeben der Warn 1 Rolle:", err); }
    }

    try {
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️ Link erkannt — Warnung 1")
            .setColor(0xffa500)
            .setDescription(
              `${message.author} wurde für **1 Stunde** getimeouted und hat die Rolle **Warn 1** erhalten.`
            )
            .addFields({ name: "Grund", value: "Link ohne Erlaubnis gesendet" })
            .setFooter({ text: "Beim nächsten Link folgt ein permanenter Ban." })
            .setTimestamp(),
        ],
      });
    } catch {}

    try {
      await message.author.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️ Warnung — Link verboten")
            .setColor(0xffa500)
            .setDescription(
              `Du hast auf **${guild.name}** einen Link gesendet.\n\nDu wurdest für **1 Stunde** getimeouted und hast die Rolle **Warn 1** erhalten.\n\n🚨 Beim nächsten Link wirst du **permanent gebannt**.`
            )
            .setTimestamp(),
        ],
      });
    } catch {}
  } else {
    try {
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔨 Link erkannt — Permanent gebannt")
            .setColor(0xed4245)
            .setDescription(`${message.author} wurde permanent **gebannt** (2. Link-Verstoß).`)
            .setTimestamp(),
        ],
      });
    } catch {}

    try {
      await message.author.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔨 Du wurdest gebannt")
            .setColor(0xed4245)
            .setDescription(
              `Du wurdest von **${guild.name}** permanent gebannt, da du erneut einen Link gesendet hast.`
            )
            .setTimestamp(),
        ],
      });
    } catch {}

    try {
      await guild.members.ban(userId, { reason: "2. Link-Verstoß — erneutes Senden eines Links" });
    } catch (err) { console.error("Fehler beim Bannen:", err); }

    userWarnings.delete(userId);
  }
});

// Verify Button Handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "verify_button") return;

  const guild = interaction.guild;
  if (!guild) return;

  const member = interaction.member as GuildMember;
  if (!member) return;

  // Rollen suchen
  const mitgliedRolle = guild.roles.cache.find((r) => r.name === "» Mitglied");
  const hauptRolle = guild.roles.cache.find(
    (r) => r.name.includes("Mitglied") &&
      (r.name.includes("💙") || r.name.includes("💎") || r.name.includes("❤") || r.name.includes("🔷"))
  );

  if (!mitgliedRolle && !hauptRolle) {
    await interaction.reply({
      content: "❌ Die Rollen wurden auf dem Server nicht gefunden. Bitte kontaktiere einen Admin.",
      ephemeral: true,
    });
    return;
  }

  // Prüfen ob schon verifiziert
  const bereitsVerifiziert =
    (mitgliedRolle && member.roles.cache.has(mitgliedRolle.id)) ||
    (hauptRolle && member.roles.cache.has(hauptRolle.id));

  if (bereitsVerifiziert) {
    await interaction.reply({
      content: "✅ Du bist bereits verifiziert!",
      ephemeral: true,
    });
    return;
  }

  try {
    if (mitgliedRolle) await member.roles.add(mitgliedRolle);
    if (hauptRolle) await member.roles.add(hauptRolle);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Erfolgreich verifiziert!")
          .setColor(0x57f287)
          .setDescription(`Willkommen auf dem Server, ${interaction.user}! Du hast die Rolle **» Mitglied** erhalten.`)
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  } catch (err) {
    console.error("Fehler beim Verify:", err);
    await interaction.reply({
      content: "❌ Fehler beim Vergeben der Rollen. Bitte kontaktiere einen Admin.",
      ephemeral: true,
    });
  }
});

// Slash Command Handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction as ChatInputCommandInteraction;
  const guild = command.guild;

  if (!guild) {
    await command.reply({ content: "Nur auf einem Server nutzbar.", ephemeral: true });
    return;
  }

  // Antwort zurückhalten — bei Ankündigung nur für den Ausführenden sichtbar
  const ephemeralCommands = ["ankündigung"];
  await command.deferReply({ ephemeral: ephemeralCommands.includes(command.commandName) });

  // ── /bewerbung ───────────────────────────────────────────────
  if (command.commandName === "bewerbung") {
    const targetUser = command.options.getUser("user", true);
    const entscheidung = command.options.getString("entscheidung", true);
    const rollenName = command.options.getString("rolle");

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await command.editReply({ content: "User nicht auf diesem Server gefunden." });
      return;
    }

    if (entscheidung === "angenommen") {
      if (!rollenName) {
        await command.editReply({ content: "Bei einer Annahme musst du eine Rolle auswählen!" });
        return;
      }

      const rolle = guild.roles.cache.find((r) => r.name === rollenName);
      if (!rolle) {
        await command.editReply({
          content: `Die Rolle **${rollenName}** wurde auf diesem Server nicht gefunden. Bitte prüfe ob sie genau so heißt.`,
        });
        return;
      }

      try {
        await member.roles.add(rolle.id);
        const hauptRolleName = await vergebeHauptrolle(member, rollenName);

        await command.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Bewerbung Angenommen")
              .setColor(0x57f287)
              .setDescription(`Die Bewerbung von ${targetUser} wurde **angenommen**!`)
              .addFields(
                { name: "User", value: `${targetUser}`, inline: true },
                { name: "Rolle", value: `${rolle}`, inline: true },
                { name: "Hauptrolle", value: hauptRolleName ?? "Nicht gefunden", inline: true },
                { name: "Bearbeitet von", value: `${command.user}`, inline: true }
              )
              .setTimestamp(),
          ],
        });

        try {
          await targetUser.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("✅ Bewerbung Angenommen!")
                .setColor(0x57f287)
                .setDescription(
                  `Deine Bewerbung auf **${guild.name}** wurde angenommen! Du hast die Rolle **${rolle.name}** erhalten.`
                )
                .setTimestamp(),
            ],
          });
        } catch {}
      } catch (error) {
        console.error("Fehler beim Zuweisen der Rolle:", error);
        await command.editReply({
          content: "Fehler beim Zuweisen der Rolle. Überprüfe ob der Bot Administrator-Rechte hat und seine Rolle ganz oben in der Rollenliste steht.",
        });
      }
    } else {
      await command.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌ Bewerbung Abgelehnt")
            .setColor(0xed4245)
            .setDescription(`Die Bewerbung von ${targetUser} wurde **abgelehnt**.`)
            .addFields(
              { name: "User", value: `${targetUser}`, inline: true },
              { name: "Bearbeitet von", value: `${command.user}`, inline: true }
            )
            .setTimestamp(),
        ],
      });

      try {
        await targetUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌ Bewerbung Abgelehnt")
              .setColor(0xed4245)
              .setDescription(`Deine Bewerbung auf **${guild.name}** wurde leider abgelehnt.`)
              .setTimestamp(),
          ],
        });
      } catch {}
    }
  }

  // ── /uprank ──────────────────────────────────────────────────
  else if (command.commandName === "uprank") {
    const targetUser = command.options.getUser("user", true);
    const vonName = command.options.getString("von", true);
    const zuName = command.options.getString("zu", true);

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await command.editReply({ content: "User nicht auf diesem Server gefunden." });
      return;
    }

    const vonRolle = guild.roles.cache.find((r) => r.name === vonName);
    const zuRolle = guild.roles.cache.find((r) => r.name === zuName);

    if (!vonRolle || !zuRolle) {
      await command.editReply({
        content: `Eine der Rollen wurde auf dem Server nicht gefunden. Prüfe die genauen Rollennamen.`,
      });
      return;
    }

    try {
      await member.roles.remove(vonRolle.id);
      await entferneHauptrolle(member, vonName);
      await member.roles.add(zuRolle.id);
      await vergebeHauptrolle(member, zuName);

      await command.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔼 Uprank")
            .setColor(0x57f287)
            .setDescription(`${targetUser} wurde erfolgreich hochgerankt!`)
            .addFields(
              { name: "User", value: `${targetUser}`, inline: true },
              { name: "Von", value: vonName, inline: true },
              { name: "Zu", value: zuName, inline: true }
            )
            .setFooter({ text: `Eingetragen von ${command.user.tag}` })
            .setTimestamp(),
        ],
      });
    } catch (error) {
      console.error("Fehler beim Uprank:", error);
      await command.editReply({ content: "Fehler beim Uprank. Überprüfe die Bot-Berechtigungen." });
    }
  }

  // ── /derank ──────────────────────────────────────────────────
  else if (command.commandName === "derank") {
    const targetUser = command.options.getUser("user", true);
    const vonName = command.options.getString("von", true);
    const zuName = command.options.getString("zu", true);

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await command.editReply({ content: "User nicht auf diesem Server gefunden." });
      return;
    }

    const vonRolle = guild.roles.cache.find((r) => r.name === vonName);
    const zuRolle = guild.roles.cache.find((r) => r.name === zuName);

    if (!vonRolle || !zuRolle) {
      await command.editReply({
        content: `Eine der Rollen wurde auf dem Server nicht gefunden. Prüfe die genauen Rollennamen.`,
      });
      return;
    }

    try {
      await member.roles.remove(vonRolle.id);
      await entferneHauptrolle(member, vonName);
      await member.roles.add(zuRolle.id);
      await vergebeHauptrolle(member, zuName);

      await command.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔽 Derank")
            .setColor(0xed4245)
            .setDescription(`${targetUser} wurde gederankt.`)
            .addFields(
              { name: "User", value: `${targetUser}`, inline: true },
              { name: "Von", value: vonName, inline: true },
              { name: "Zu", value: zuName, inline: true }
            )
            .setFooter({ text: `Eingetragen von ${command.user.tag}` })
            .setTimestamp(),
        ],
      });
    } catch (error) {
      console.error("Fehler beim Derank:", error);
      await command.editReply({ content: "Fehler beim Derank. Überprüfe die Bot-Berechtigungen." });
    }
  }

  // ── /teamwarn ─────────────────────────────────────────────────
  else if (command.commandName === "teamwarn") {
    const executor = command.member as GuildMember;
    if (!hatErlaubteRolle(executor)) {
      await command.editReply({ content: "❌ Du hast keine Berechtigung für diesen Befehl." });
      return;
    }

    const targetUser = command.options.getUser("user", true);
    const dauer = command.options.getString("dauer", true);
    const grund = command.options.getString("grund", true);

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await command.editReply({ content: "User nicht auf diesem Server gefunden." });
      return;
    }

    // Aktuelle Warn-Rollen prüfen (rollenbasiert)
    const hatWarn1 =
      member.roles.cache.some((r) => r.name === "Team Warn 1") ||
      member.roles.cache.some((r) => r.name === "Team Warn 1 (Dauerhaft)");
    const hatWarn2 =
      member.roles.cache.some((r) => r.name === "Team Warn 2") ||
      member.roles.cache.some((r) => r.name === "Team Warn 2 (Dauerhaft)");

    if (hatWarn2) {
      await command.editReply({
        content: `${targetUser} hat bereits **Team Warn 2** — maximale Warnungen erreicht.`,
      });
      return;
    }

    // Warn-Rolle bestimmen
    const warnRollenName = hatWarn1
      ? dauer === "dauerhaft" ? "Team Warn 2 (Dauerhaft)" : "Team Warn 2"
      : dauer === "dauerhaft" ? "Team Warn 1 (Dauerhaft)" : "Team Warn 1";

    const warnNummer = hatWarn1 ? 2 : 1;
    const warnRolle = guild.roles.cache.find((r) => r.name === warnRollenName);

    if (!warnRolle) {
      await command.editReply({
        content: `❌ Rolle **${warnRollenName}** nicht gefunden. Bitte prüfe ob sie auf dem Server existiert.`,
      });
      return;
    }

    try {
      await member.roles.add(warnRolle);

      await command.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`⚠️ Team Warn ${warnNummer} — ${dauer === "dauerhaft" ? "Dauerhaft" : "Normal"}`)
            .setColor(0xffa500)
            .setDescription(`${targetUser} hat eine **Teamwarnung** erhalten.`)
            .addFields(
              { name: "Teammitglied", value: `${targetUser}`, inline: true },
              { name: "Warn", value: `Team Warn ${warnNummer} (${dauer === "dauerhaft" ? "Dauerhaft" : "Normal"})`, inline: true },
              { name: "Grund", value: grund, inline: false },
              { name: "Ausgestellt von", value: `${command.user}`, inline: true },
              { name: "Datum", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: `Rp Bot • Teamwarnung` })
            .setTimestamp(),
        ],
      });

      try {
        await targetUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`⚠️ Du hast eine Teamwarnung erhalten`)
              .setColor(0xffa500)
              .setDescription(`Du hast auf **${guild.name}** eine Teamwarnung erhalten.`)
              .addFields(
                { name: "Warn", value: `Team Warn ${warnNummer} (${dauer === "dauerhaft" ? "Dauerhaft" : "Normal"})`, inline: true },
                { name: "Grund", value: grund, inline: false },
                { name: "Ausgestellt von", value: command.user.tag, inline: true }
              )
              .setTimestamp(),
          ],
        });
      } catch {}
    } catch (err) {
      console.error("Fehler beim Teamwarn:", err);
      await command.editReply({ content: "Fehler beim Vergeben der Warn-Rolle. Überprüfe die Bot-Berechtigungen." });
    }
  }

  // ── /ban ──────────────────────────────────────────────────────
  else if (command.commandName === "ban") {
    const executor = command.member as GuildMember;
    if (!hatErlaubteRolle(executor)) {
      await command.editReply({ content: "❌ Du hast keine Berechtigung für diesen Befehl." });
      return;
    }

    const targetUser = command.options.getUser("user", true);
    const grund = command.options.getString("grund", true);

    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    try {
      try {
        await targetUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔨 Du wurdest gebannt")
              .setColor(0xed4245)
              .setDescription(`Du wurdest von **${guild.name}** gebannt.`)
              .addFields(
                { name: "Grund", value: grund, inline: false },
                { name: "Gebannt von", value: command.user.tag, inline: true }
              )
              .setTimestamp(),
          ],
        });
      } catch {}

      await guild.members.ban(targetUser.id, { reason: `${grund} | Gebannt von: ${command.user.tag}` });

      await command.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔨 User gebannt")
            .setColor(0xed4245)
            .setDescription(`${targetUser} wurde erfolgreich vom Server gebannt.`)
            .addFields(
              { name: "User", value: `${targetUser} (${targetUser.tag})`, inline: true },
              { name: "Grund", value: grund, inline: false },
              { name: "Bann durchgeführt von", value: `${command.user}`, inline: true },
              { name: "Datum", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: `Rp Bot • Bann` })
            .setTimestamp(),
        ],
      });
    } catch (err) {
      console.error("Fehler beim Ban:", err);
      await command.editReply({ content: "Fehler beim Bannen. Überprüfe ob der Bot Administrator-Rechte hat." });
    }
  }

  // ── /ankündigung ─────────────────────────────────────────────
  else if (command.commandName === "ankündigung") {
    const executor = command.member as GuildMember;
    if (!hatErlaubteRolle(executor)) {
      await command.editReply({ content: "❌ Du hast keine Berechtigung für diesen Befehl." });
      return;
    }

    const text = command.options.getString("text", true);

    const embed = new EmbedBuilder()
      .setTitle("📢 Ankündigung")
      .setColor(0x5865f2)
      .setDescription(text)
      .setFooter({ text: `von ${command.user.tag}` })
      .setTimestamp();

    await command.channel?.send({
      content: "@everyone",
      embeds: [embed],
      allowedMentions: { parse: ["everyone"] },
    });

    // Nur für den Ausführenden sichtbar
    await command.editReply({ content: "✅ Ankündigung wurde gesendet!" });
  }

  // ── /teamkick ─────────────────────────────────────────────────
  else if (command.commandName === "teamkick") {
    const executor = command.member as GuildMember;
    if (!hatErlaubteRolle(executor)) {
      await command.editReply({ content: "❌ Du hast keine Berechtigung für diesen Befehl." });
      return;
    }

    const targetUser = command.options.getUser("user", true);
    const grund = command.options.getString("grund", true);

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await command.editReply({ content: "User nicht auf diesem Server gefunden." });
      return;
    }

    // Rollen die behalten werden sollen
    const BEHALTE_ROLLEN = ["» Mitglied"];

    // Alle Rollen sammeln die entfernt werden (außer @everyone, Mitglied-Rollen und 💙Mitglied💙)
    const zuEntfernen = member.roles.cache.filter((r) => {
      if (r.name === "@everyone") return false;
      if (BEHALTE_ROLLEN.includes(r.name)) return false;
      // Mitglied-Separator behalten (enthält "Mitglied" + Emoji)
      if (r.name.includes("Mitglied") && (r.name.includes("💙") || r.name.includes("💎") || r.name.includes("❤") || r.name.includes("🔷"))) return false;
      return true;
    });

    try {
      await member.roles.remove(zuEntfernen);

      await command.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("👢 Teamkick")
            .setColor(0xed4245)
            .setDescription(`${targetUser} wurde aus dem Team entfernt. Alle Teamrollen wurden entzogen.`)
            .addFields(
              { name: "Teammitglied", value: `${targetUser}`, inline: true },
              { name: "Entfernte Rollen", value: zuEntfernen.size > 0 ? zuEntfernen.map((r) => r.name).join(", ") : "Keine", inline: false },
              { name: "Grund", value: grund, inline: false },
              { name: "Durchgeführt von", value: `${command.user}`, inline: true },
              { name: "Datum", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: "Rp Bot • Teamkick" })
            .setTimestamp(),
        ],
      });

      try {
        await targetUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("👢 Du wurdest aus dem Team entfernt")
              .setColor(0xed4245)
              .setDescription(`Du wurdest auf **${guild.name}** aus dem Team entfernt. Alle deine Teamrollen wurden entzogen.`)
              .addFields(
                { name: "Grund", value: grund, inline: false },
                { name: "Durchgeführt von", value: command.user.tag, inline: true }
              )
              .setTimestamp(),
          ],
        });
      } catch {}
    } catch (err) {
      console.error("Fehler beim Teamkick:", err);
      await command.editReply({ content: "Fehler beim Entfernen der Rollen. Überprüfe die Bot-Berechtigungen." });
    }
  }

  // ── /setup-verify ────────────────────────────────────────────
  else if (command.commandName === "setup-verify") {
    const verifyButton = new ButtonBuilder()
      .setCustomId("verify_button")
      .setLabel("✅ Verifizieren")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);

    const embed = new EmbedBuilder()
      .setTitle("✅ Verifizierung")
      .setColor(0x57f287)
      .setDescription(
        "Willkommen auf unserem Server!\n\nKlicke auf den Button unten um dich zu verifizieren und Zugang zum Server zu erhalten."
      )
      .setFooter({ text: "Nur einmal klicken — du bekommst sofort deine Rollen." })
      .setTimestamp();

    await command.editReply({ content: "Verifizierungs-Nachricht wurde gesendet!" });

    await command.channel?.send({ embeds: [embed], components: [row] });
  }
});

// Download-Archiv beim Start erstellen
// __dirname = /home/runner/workspace/discord-bot/src
// workspace = zwei Ebenen höher
const ARCHIVE_PATH = "/tmp/discord-bot.tar.gz";
const WORKSPACE_DIR = path.resolve(__dirname, "../../");
try {
  execSync(
    `tar --exclude='discord-bot/node_modules' --exclude='discord-bot/.env' -czf ${ARCHIVE_PATH} -C ${WORKSPACE_DIR} discord-bot`,
    { stdio: "pipe" }
  );
  console.log("Download-Archiv erstellt.");
} catch (e) {
  console.error("Fehler beim Erstellen des Archivs:", e);
}

// Health-Check + Download HTTP Server
const PORT = process.env.PORT ?? 3000;
http
  .createServer((req, res) => {
    if (req.url === "/download") {
      if (!fs.existsSync(ARCHIVE_PATH)) {
        res.writeHead(404);
        res.end("Archiv nicht gefunden.");
        return;
      }
      const stat = fs.statSync(ARCHIVE_PATH);
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": "attachment; filename=\"discord-bot.tar.gz\"",
        "Content-Length": stat.size,
      });
      fs.createReadStream(ARCHIVE_PATH).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Bot is alive!");
    }
  })
  .listen(PORT, () => {
    console.log(`Health-Check Server läuft auf Port ${PORT}`);
    console.log(`Download: https://5687b15c-b7a8-4c85-b2ee-731d425adb00-00-yyhxpn99z5f2.riker.replit.dev/download`);
  });

client.login(token);
