require('dotenv').config();
const fs = require('fs');
const {
Client,
GatewayIntentBits,
SlashCommandBuilder,
PermissionFlagsBits,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
ModalBuilder,
TextInputBuilder,
TextInputStyle
} = require('discord.js');

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers
]
});

const loadConfig = () => {
try {
return JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch {
return {};
}
};

const saveConfig = (d) =>
fs.writeFileSync('./config.json', JSON.stringify(d, null, 2));

/* -------------------- RS FUNCTIONS -------------------- */

async function verifyRSN(rsn) {
try {
const r = await fetch(
`https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(rsn)}`
);
return r.ok;
} catch (err) {
console.error('verifyRSN error:', err);
return false;
}
}

async function isClanMember(rsn, clanName) {
try {
const r = await fetch(
`https://secure.runescape.com/m=clan-hiscores/members_lite.ws?clanName=${encodeURIComponent(clanName)}`
);

if (!r.ok) return false;

const csv = await r.text();

return csv.split('\n').some(line => {
const name = (line.split(',')[0] || '').trim();
return name.toLowerCase() === rsn.toLowerCase();
});

} catch (err) {
console.error('clan check error:', err);
return false;
}
}

/* -------------------- READY -------------------- */

client.once('ready', async () => {

const commands = [

new SlashCommandBuilder()
.setName('setup-channel')
.setDescription('Set welcome channel')
.addChannelOption(o =>
o.setName('channel')
.setDescription('Channel')
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

new SlashCommandBuilder()
.setName('setup-clan')
.setDescription('Set clan name')
.addStringOption(o =>
o.setName('clan')
.setDescription('Clan')
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

new SlashCommandBuilder()
.setName('setup-member-role')
.setDescription('Role for clan members')
.addRoleOption(o =>
o.setName('role')
.setDescription('Member role')
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

new SlashCommandBuilder()
.setName('setup-guest-role')
.setDescription('Role for non-clan members')
.addRoleOption(o =>
o.setName('role')
.setDescription('Guest role')
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

new SlashCommandBuilder()
.setName('status')
.setDescription('Show config')

];

await client.application.commands.set(commands.map(c => c.toJSON()));

console.log('Ready as', client.user.tag);
});

/* -------------------- INTERACTIONS -------------------- */

client.on('interactionCreate', async interaction => {

const cfg = loadConfig();
const gid = interaction.guild?.id;
if (gid && !cfg[gid]) cfg[gid] = {};

/* -------- COMMANDS -------- */

if (interaction.isChatInputCommand()) {

if (interaction.commandName === 'setup-channel') {
cfg[gid].welcomeChannel =
interaction.options.getChannel('channel').id;

saveConfig(cfg);

return interaction.reply({
content: 'Welcome channel set',
ephemeral: true
});
}

if (interaction.commandName === 'setup-clan') {
cfg[gid].clan =
interaction.options.getString('clan');

saveConfig(cfg);

return interaction.reply({
content: `Clan set: ${cfg[gid].clan}`,
ephemeral: true
});
}

if (interaction.commandName === 'setup-member-role') {
cfg[gid].memberRole =
interaction.options.getRole('role').id;

saveConfig(cfg);

return interaction.reply({
content: 'Member role set',
ephemeral: true
});
}

if (interaction.commandName === 'setup-guest-role') {
cfg[gid].guestRole =
interaction.options.getRole('role').id;

saveConfig(cfg);

return interaction.reply({
content: 'Guest role set',
ephemeral: true
});
}

if (interaction.commandName === 'status') {
return interaction.reply({
content: '```json\n' +
JSON.stringify(cfg[gid] || {}, null, 2) +
'\n```',
ephemeral: true
});
}
}

/* -------- BUTTON -------- */

if (interaction.isButton() && interaction.customId === 'add_rsn') {

const modal = new ModalBuilder()
.setCustomId('rsn_modal')
.setTitle('Add RSN');

const input = new TextInputBuilder()
.setCustomId('rsn')
.setLabel('RuneScape Name')
.setStyle(TextInputStyle.Short)
.setRequired(true);

modal.addComponents(
new ActionRowBuilder().addComponents(input)
);

return interaction.showModal(modal);
}

/* -------- MODAL -------- */

if (interaction.isModalSubmit() && interaction.customId === 'rsn_modal') {

const rsn = interaction.fields.getTextInputValue('rsn');

const guildCfg = cfg[gid];
const clan = guildCfg?.clan;

if (!clan) {
return interaction.reply({
content: 'Clan not set. Use /setup-clan',
ephemeral: true
});
}

await interaction.deferReply({ ephemeral: true });

/* check RSN */
if (!(await verifyRSN(rsn))) {
return interaction.editReply({
content: `❌ RSN not found: ${rsn}`
});
}

/* check clan (non-blocking logic) */
let inClan = false;
try {
inClan = await isClanMember(rsn, clan);
} catch (e) {
console.error(e);
}

/* nickname update */
try {
const member = await interaction.guild.members.fetch(interaction.user.id);
await member.setNickname(rsn);
} catch (err) {
console.error('Nickname error:', err);
}

/* roles */
try {
const member = await interaction.guild.members.fetch(interaction.user.id);

if (inClan && guildCfg.memberRole) {
await member.roles.add(guildCfg.memberRole);
}

if (!inClan && guildCfg.guestRole) {
await member.roles.add(guildCfg.guestRole);
}
} catch (err) {
console.error('Role error:', err);
}

/* delete welcome message */
try {
const welcome = guildCfg.welcomeMessages?.[interaction.user.id];

if (welcome) {
const channel = await interaction.guild.channels.fetch(welcome.channelId);
const msg = await channel.messages.fetch(welcome.messageId);
await msg.delete();

delete cfg[gid].welcomeMessages[interaction.user.id];
saveConfig(cfg);
}
} catch (err) {
console.error('Delete welcome error:', err);
}

/* response */
return interaction.editReply({
content: inClan
? `✅ Verified: ${rsn} is in ${clan}`
: `✅ Verified: ${rsn} exists but is NOT in ${clan}`
});
}
});

/* -------------------- WELCOME -------------------- */

client.on('guildMemberAdd', async member => {

const cfg = loadConfig();
const guildCfg = cfg[member.guild.id];

if (!guildCfg?.welcomeChannel) return;

const ch = member.guild.channels.cache.get(guildCfg.welcomeChannel);
if (!ch) return;

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId('add_rsn')
.setLabel('Add RSN')
.setStyle(ButtonStyle.Primary)
);

const msg = await ch.send({
content: `Welcome ${member}! Click Add RSN below.`,
components: [row]
});

cfg[member.guild.id].welcomeMessages ??= {};

cfg[member.guild.id].welcomeMessages[member.id] = {
channelId: ch.id,
messageId: msg.id
};

saveConfig(cfg);
});

client.login(process.env.TOKEN);