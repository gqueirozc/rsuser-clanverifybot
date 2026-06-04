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
    TextInputStyle,
    EmbedBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType
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

const saveConfig = (d) => {
    // Safeguard: don't save if d is empty and config already has data
    try {
        if (Object.keys(d).length === 0) {
            const existing = loadConfig();
            if (Object.keys(existing).length > 0) {
                console.warn('⚠️ Prevented saving empty config over existing data!');
                return;
            }
        }
    } catch (err) {
        console.error('Safeguard check error:', err);
    }
    fs.writeFileSync('./config.json', JSON.stringify(d, null, 2));
};

const DEFAULT_SEARCHING_MESSAGE = '🔎 Searching RuneScape name...';
const DEFAULT_WELCOME_REPLY = 'Welcome to the server!';
const TICKET_TYPE_BUTTON_PREFIX = 'ticket_type_';
const TICKET_CLOSE_BUTTON = 'close_ticket';
const TICKET_DELETE_BUTTON = 'delete_ticket';
const TICKET_MODAL_PREFIX = 'ticket_modal_';
const SETUP_WIZARD_BUTTON = 'setup_wizard_start';
const SETUP_TICKET_WIZARD_BUTTON = 'setup_ticket_wizard_start';
const SETUP_TICKET_CATEGORY_SELECT = 'setup_ticket_category_select';
const SETUP_TICKET_SUPPORT_ROLE_SELECT = 'setup_ticket_support_role_select';
const SETUP_TICKET_TYPE_SUPPORTS_SELECT = 'setup_ticket_type_supports_select';
const SETUP_TICKET_WIZARD_CONTINUE = 'setup_ticket_wizard_continue';
const SETUP_WELCOME_CHANNEL_SELECT = 'setup_welcome_channel_select';
const SETUP_MEMBER_ROLE_SELECT = 'setup_member_role_select';
const SETUP_GUEST_ROLE_SELECT = 'setup_guest_role_select';
const SETUP_LOGS_CHANNEL_SELECT = 'setup_logs_channel_select';
const SETUP_WIZARD_CONTINUE = 'setup_wizard_continue';
const SETUP_TICKET_NOTIFY_ROLE_SELECT = 'setup_ticket_notify_role_select';

const DEFAULT_TICKET_PANEL_TITLE = 'Open a Support Ticket';
const DEFAULT_TICKET_PANEL_DESC = 'Choose the ticket type that matches your issue. A new private channel will be created for you and the configured support roles.';
const DEFAULT_TICKET_EMBED_TITLE = 'Ticket: {type}';
const DEFAULT_TICKET_EMBED_DESC = 'Issue: {subject}';

const tempSetup = {}; // in-memory temporary selections during wizard (per guild -> user)

const getGuildConfig = (cfg, gid) => {
    if (!gid) return null;
    if (!cfg[gid]) cfg[gid] = {};
    return cfg[gid];
};

const getGuildRole = async (guild, roleId) => {
    if (!roleId) return null;
    return guild.roles.cache.get(roleId) ||
        await guild.roles.fetch(roleId).catch(() => null);
};

const applyMemberRoles = async (member, guildCfg, inClan) => {
    let addedRoleName = null;
    const memberRole = await getGuildRole(member.guild, guildCfg.memberRole);
    const guestRole = await getGuildRole(member.guild, guildCfg.guestRole);

    if (inClan && memberRole) {
        await member.roles.add(memberRole).catch(() => null);
        addedRoleName = memberRole.name;
        if (guestRole) await member.roles.remove(guestRole).catch(() => null);
    }

    if (!inClan && guestRole) {
        await member.roles.add(guestRole).catch(() => null);
        addedRoleName = guestRole.name;
        if (memberRole) await member.roles.remove(memberRole).catch(() => null);
    }

    return addedRoleName;
};

const removeWelcomeMessage = async (cfg, gid, guildCfg, memberId) => {
    const welcome = guildCfg?.welcomeMessages?.[memberId];
    if (!welcome) return;

    try {
        const msgChannel = await client.channels.fetch(welcome.channelId).catch(() => null);
        const msg = msgChannel ? await msgChannel.messages.fetch(welcome.messageId).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => null);
    } catch (err) {
        console.error('Delete welcome error:', err);
    }

    delete guildCfg.welcomeMessages[memberId];
    saveConfig(cfg);
};

const buildVerificationReply = (inClan, clan, clanRank, roleText) => {
    const prefix = DEFAULT_WELCOME_REPLY;
    return inClan ?
        `${prefix} Your RuneScape name is verified and you are a member of ${clan}${clanRank ? ` (rank ${clanRank})` : ''}.\nEnjoy your stay.\n${roleText}` :
        `${prefix} Your RuneScape name is verified, but you are not currently listed in ${clan}.\nEnjoy your stay.\n${roleText}`;
};

const buildVerificationEmbed = (member, rsn, inClan, clan, clanRank, addedRoleName, title) => {
    const statusText = inClan ? `In clan **${clan}**${clanRank ? ` (rank ${clanRank})` : ''}` : `Not in clan **${clan}**`;
    return new EmbedBuilder()
        .setColor(inClan ? 0x00FF00 : 0xFFA500)
        .setTitle(title)
        .setDescription('A member updated their RuneScape name and verification status.')
        .addFields(
            { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: false },
            { name: 'RSN', value: `**${rsn}**`, inline: true },
            { name: 'Status', value: statusText, inline: true },
            { name: 'Role', value: addedRoleName ? `**${addedRoleName}**` : 'No role assigned', inline: true }
        )
        .setTimestamp();
};

const normalizeTicketName = username =>
    `ticket-${username.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 18)}-${Date.now() % 10000}`;

const normalizeTicketTypeId = name =>
    name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 16);

const chunkArray = (items, size) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
};

const parseRoleIds = input => {
    if (!input) return [];
    const ids = new Set();
    const matches = [...input.matchAll(/<@&?(\d+)>|\d+/g)];
    for (const match of matches) {
        if (match[1]) ids.add(match[1]);
    }
    return [...ids];
};

const parseChannelIds = input => {
    if (!input) return [];
    const ids = new Set();
    const matches = [...input.matchAll(/<#(\d+)>|\d+/g)];
    for (const match of matches) {
        if (match[1]) ids.add(match[1]);
    }
    return [...ids];
};

const resolveChannel = async (guild, value) => {
    if (!value) return null;
    const match = value.match(/<#?(\d+)>?/);
    if (!match) return null;
    return guild.channels.cache.get(match[1]) || await guild.channels.fetch(match[1]).catch(() => null);
};

const resolveRole = async (guild, value) => {
    if (!value) return null;
    const match = value.match(/<@&?(\d+)>?/);
    if (!match) return null;
    return guild.roles.cache.get(match[1]) || await guild.roles.fetch(match[1]).catch(() => null);
};

const buildTicketPanelMessage = (ticketTypes, guildCfg = {}) => {
    const buttons = Object.entries(ticketTypes || {}).map(([typeId, type]) =>
        new ButtonBuilder()
            .setCustomId(`${TICKET_TYPE_BUTTON_PREFIX}${typeId}`)
            .setLabel(type.label || typeId)
            .setStyle(ButtonStyle.Primary)
    );

    const rows = chunkArray(buttons, 5).map(buttonRow =>
        new ActionRowBuilder().addComponents(buttonRow)
    );

    const panelTitle = guildCfg.ticketPanelTitle || DEFAULT_TICKET_PANEL_TITLE;
    const panelDesc = guildCfg.ticketPanelDescription || DEFAULT_TICKET_PANEL_DESC;

    const embed = new EmbedBuilder()
        .setTitle(panelTitle)
        .setDescription(panelDesc)
        .setColor(0x5865F2)
        .addFields(
            { name: 'How it works', value: '1) Click a button\n2) Describe your issue\n3) A private channel is created with support access', inline: false },
            { name: 'Ticket types', value: Object.values(ticketTypes).map(type => `• **${type.label}**: ${type.description}`).join('\n') || 'No ticket types configured', inline: false }
        );

    return {
        embeds: [embed],
        components: rows
    };
};

const createTicketChannel = async (guild, categoryId, ticketName, member, supportRoleIds = []) => {
    if (!categoryId) return null;

    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return null;

    const overwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: member.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
            ]
        }
    ];

    const validRoleIds = [];
    for (const roleId of supportRoleIds || []) {
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (role) validRoleIds.push(role.id);
    }

    for (const roleId of [...new Set(validRoleIds)]) {
        overwrites.push({
            id: roleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    return guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overwrites
    }).catch(() => null);
};

const closeTicketChannel = async (channel, supportRoleId) => {
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    const overwrites = [
        {
            id: channel.guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
        }
    ];

    if (supportRoleId) {
        overwrites.push({
            id: supportRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    try {
        await channel.permissionOverwrites.set(overwrites);
        await channel.send({ content: '✅ This ticket has been closed. Support may reopen it or archive it later.' }).catch(() => null);
        return true;
    } catch (err) {
        console.error('Close ticket error:', err);
        return false;
    }
};

const buildTicketEmbed = (member, subject, supportRoleIds, typeLabel, notifyRoleId, customTitle = null, customMsg = null) => {
    const title = customTitle?.replace('{type}', typeLabel) || DEFAULT_TICKET_EMBED_TITLE.replace('{type}', typeLabel);
    const description = customMsg?.replace('{subject}', subject) || DEFAULT_TICKET_EMBED_DESC.replace('{subject}', subject);
    const supportAccess = supportRoleIds?.length ? supportRoleIds.map(id => `<@&${id}>`).join(', ') : 'No role access configured';

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .addFields(
            { name: 'Requester', value: `<@${member.id}>`, inline: true },
            { name: 'Support access', value: supportAccess, inline: true },
            { name: 'Notify role', value: notifyRoleId ? `<@&${notifyRoleId}>` : 'None', inline: true }
        )
        .setTimestamp();
};

const buildTicketPanel = (ticketTypes, guildCfg = {}) => buildTicketPanelMessage(ticketTypes, guildCfg);

const buildSetupWizardMessage = (guildCfg = {}) => {
    const setupLabel = guildCfg.clan && guildCfg.welcomeChannel && guildCfg.memberRole && guildCfg.guestRole ? 'Update Clan Setup' : 'Start Clan Setup Wizard';
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETUP_WIZARD_BUTTON)
            .setLabel(setupLabel)
            .setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
        .setTitle('Clan Setup Wizard')
        .setDescription('Click the button below to configure your clan settings in one place. This wizard saves the clan name, welcome channel, member/guest roles, and optional log channel.')
        .setColor(0x00B0F4)
        .addFields(
            { name: 'Step 1', value: 'Click the button to open the setup modal.', inline: false },
            { name: 'Step 2', value: 'Provide the clan name, welcome channel, member role, guest role, and optional logs channel.', inline: false },
            { name: 'Step 3', value: 'The bot will save your settings and confirm them.', inline: false }
        );

    return {
        embeds: [embed],
        components: [row]
    };
};

const buildSetupTicketWizardMessage = (guildCfg = {}) => {
    const setupLabel = guildCfg.ticketCategory && guildCfg.ticketSupportRole && guildCfg.ticketTypes && Object.keys(guildCfg.ticketTypes).length ? 'Update Ticket Setup' : 'Start Ticket Setup Wizard';
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETUP_TICKET_WIZARD_BUTTON)
            .setLabel(setupLabel)
            .setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
        .setTitle('Ticket Setup Wizard')
        .setDescription('Click the button below to configure your ticket category, default support role, and an initial ticket type.')
        .setColor(0x57F287)
        .addFields(
            { name: 'Step 1', value: 'Click the button to open the ticket setup modal.', inline: false },
            { name: 'Step 2', value: 'Provide the ticket category, default support role, ticket type name, description, and optional support roles.', inline: false },
            { name: 'Step 3', value: 'Use /create-ticket-panel to publish the ticket type panel once setup is complete.', inline: false }
        );

    return {
        embeds: [embed],
        components: [row]
    };
};

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

async function getClanMemberInfo(rsn, clanName) {
    try {
        const r = await fetch(
            `https://secure.runescape.com/m=clan-hiscores/members_lite.ws?clanName=${encodeURIComponent(clanName)}`
        );

        if (!r.ok) return null;

        const csv = await r.text();
        const line = csv.split('\n').find(line => {
            const name = (line.split(',')[0] || '').trim();
            return name.toLowerCase() === rsn.toLowerCase();
        });

        if (!line) return null;

        const parts = line.split(',');
        return {
            rank: (parts[1] || '').trim() || null
        };

    } catch (err) {
        console.error('clan check error:', err);
        return null;
    }
}

/* -------------------- READY -------------------- */

const CLEANUP_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

const cleanStaleTemp = (cfg) => {
    let hasChanges = false;
    const now = Date.now();
    for (const gid of Object.keys(cfg)) {
        if (cfg[gid].wizardTemp) {
            for (const uid of Object.keys(cfg[gid].wizardTemp)) {
                const t = cfg[gid].wizardTemp[uid]?.timestamp;
                if (t && now - t > CLEANUP_AGE) {
                    delete cfg[gid].wizardTemp[uid];
                    hasChanges = true;
                }
            }
            if (Object.keys(cfg[gid].wizardTemp).length === 0) {
                delete cfg[gid].wizardTemp;
                hasChanges = true;
            }
        }
        if (cfg[gid].ticketWizardTemp) {
            for (const uid of Object.keys(cfg[gid].ticketWizardTemp)) {
                const t = cfg[gid].ticketWizardTemp[uid]?.timestamp;
                if (t && now - t > CLEANUP_AGE) {
                    delete cfg[gid].ticketWizardTemp[uid];
                    hasChanges = true;
                }
            }
            if (Object.keys(cfg[gid].ticketWizardTemp).length === 0) {
                delete cfg[gid].ticketWizardTemp;
                hasChanges = true;
            }
        }
    }
    return hasChanges;
};

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
        .setName('setup-server-logs')
        .setDescription('Set the server logs channel')
        .addChannelOption(o =>
            o.setName('channel')
            .setDescription('Server logs channel')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('setup-wizard')
        .setDescription('Create or refresh a fixed clan setup panel')
        .addChannelOption(o =>
            o.setName('channel')
            .setDescription('Channel to post the setup panel in')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('setup-ticket-wizard')
        .setDescription('Create or refresh a fixed ticket setup panel')
        .addChannelOption(o =>
            o.setName('channel')
            .setDescription('Channel to post the ticket setup panel in')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('setup-ticket-category')
        .setDescription('Set the ticket category for new tickets')
        .addChannelOption(o =>
            o.setName('category')
            .setDescription('Ticket category channel')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('setup-ticket-support-role')
        .setDescription('Set a global fallback role for tickets')
        .addRoleOption(o =>
            o.setName('role')
            .setDescription('Fallback support role')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('ticket-type-add')
        .setDescription('Add a ticket type for the ticket panel')
        .addStringOption(o =>
            o.setName('name')
            .setDescription('Ticket type name')
            .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('description')
            .setDescription('Short description for this ticket type')
            .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('support_roles')
            .setDescription('Comma-separated role mentions/IDs that should access this ticket')
            .setRequired(false)
        )
        .addRoleOption(o =>
            o.setName('notify_role')
            .setDescription('Optional role to mention in the ticket channel')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('ticket-type-remove')
        .setDescription('Remove a configured ticket type')
        .addStringOption(o =>
            o.setName('name')
            .setDescription('Ticket type name to remove')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('ticket-types')
        .setDescription('List configured ticket types')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('create-ticket-panel')
        .setDescription('Post or refresh the ticket type panel in this channel')
        .addChannelOption(o =>
            o.setName('channel')
            .setDescription('Channel to post the ticket panel in')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('verify-member')
        .setDescription('Verify a member using their RSN and update nickname/roles')
        .addUserOption(o =>
            o.setName('member')
            .setDescription('The member to verify')
            .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('rsn')
            .setDescription('The RuneScape name to verify')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('close-ticket')
        .setDescription('Close the current ticket channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('reset-config')
        .setDescription('Factory reset bot configuration (clears all settings)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('ticket-panel-customize')
        .setDescription('Customize the ticket panel title and description')
        .addStringOption(o =>
            o.setName('title')
            .setDescription('Panel title')
            .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('description')
            .setDescription('Panel description')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('ticket-type-customize')
        .setDescription('Customize the embed title and message for a ticket type')
        .addStringOption(o =>
            o.setName('name')
            .setDescription('Ticket type name')
            .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('embed_title')
            .setDescription('Custom embed title (use {type} for ticket type name)')
            .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('embed_message')
            .setDescription('Custom embed description (use {subject} for issue subject)')
            .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show config')

    ];

    await client.application.commands.set(commands.map(c => c.toJSON()));

    console.log('Ready as', client.user.tag);

    // cleanup stale wizard temp entries on startup (only save if changes were made)
    const cfg = loadConfig();
    if (cleanStaleTemp(cfg)) {
        saveConfig(cfg);
    }

    // schedule daily cleanup (only save if changes were made)
    setInterval(() => {
        const c = loadConfig();
        if (cleanStaleTemp(c)) {
            saveConfig(c);
        }
    }, 1000 * 60 * 60 * 24);
});

/* -------------------- INTERACTIONS -------------------- */

client.on('interactionCreate', async interaction => {

    const cfg = loadConfig();
    const gid = interaction.guild?.id;
    const guildCfg = getGuildConfig(cfg, gid);

    /* -------- COMMANDS -------- */

    if (interaction.isChatInputCommand()) {

        if (interaction.commandName === 'setup-channel') {
            cfg[gid].welcomeChannel =
                interaction.options.getChannel('channel').id;

            saveConfig(cfg);

            return interaction.reply({
                content: 'Welcome channel set',
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-clan') {
            cfg[gid].clan =
                interaction.options.getString('clan');

            saveConfig(cfg);

            return interaction.reply({
                content: `Clan set: ${cfg[gid].clan}`,
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-member-role') {
            cfg[gid].memberRole =
                interaction.options.getRole('role').id;

            saveConfig(cfg);

            return interaction.reply({
                content: 'Member role set',
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-guest-role') {
            cfg[gid].guestRole =
                interaction.options.getRole('role').id;

            saveConfig(cfg);

            return interaction.reply({
                content: 'Guest role set',
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-server-logs') {
            cfg[gid].serverLogsChannel =
                interaction.options.getChannel('channel').id;

            saveConfig(cfg);

            return interaction.reply({
                content: 'Server logs channel set',
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-wizard') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            if (!channel || !channel.isTextBased() || channel.isThread()) {
                return interaction.reply({
                    content: 'Please choose a text channel to post the setup panel in.',
                    flags: 64
                });
            }

            // Check bot permissions
            const botMember = await interaction.guild.members.fetchMe().catch(() => null);
            if (botMember) {
                const perms = channel.permissionsFor(botMember);
                if (!perms?.has(PermissionFlagsBits.SendMessages)) {
                    return interaction.reply({
                        content: `❌ I don't have permission to send messages in ${channel.toString()}.`,
                        flags: 64
                    });
                }
                if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({
                        content: `❌ I don't have permission to manage messages in ${channel.toString()}. (needed to pin)`,
                        flags: 64
                    });
                }
            }

            const panelData = buildSetupWizardMessage(guildCfg);
            cfg[gid].setupWizardPanel ??= {};
            let panelMessage = null;

            try {
                if (cfg[gid].setupWizardPanel.channelId && cfg[gid].setupWizardPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].setupWizardPanel.channelId).catch(() => null);
                    if (panelChannel) {
                        panelMessage = await panelChannel.messages.fetch(cfg[gid].setupWizardPanel.messageId).catch(() => null);
                    }
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                cfg[gid].setupWizardPanel = {
                    channelId: channel.id,
                    messageId: panelMessage.id
                };
                saveConfig(cfg);
            } catch (err) {
                console.error('Setup wizard panel error:', err.message || err);
                return interaction.reply({
                    content: `❌ Unable to post the setup wizard panel: ${err.message || 'Unknown error'}`,
                    flags: 64
                });
            }

            return interaction.reply({
                content: `Setup wizard panel posted in ${channel.toString()}.`,
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-ticket-wizard') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            if (!channel || !channel.isTextBased() || channel.isThread()) {
                return interaction.reply({
                    content: 'Please choose a text channel to post the ticket setup panel in.',
                    flags: 64
                });
            }

            // Check bot permissions
            const botMember = await interaction.guild.members.fetchMe().catch(() => null);
            if (botMember) {
                const perms = channel.permissionsFor(botMember);
                if (!perms?.has(PermissionFlagsBits.SendMessages)) {
                    return interaction.reply({
                        content: `❌ I don't have permission to send messages in ${channel.toString()}.`,
                        flags: 64
                    });
                }
                if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({
                        content: `❌ I don't have permission to manage messages in ${channel.toString()}. (needed to pin)`,
                        flags: 64
                    });
                }
            }

            const panelData = buildSetupTicketWizardMessage(guildCfg);
            cfg[gid].ticketSetupWizardPanel ??= {};
            let panelMessage = null;

            try {
                if (cfg[gid].ticketSetupWizardPanel.channelId && cfg[gid].ticketSetupWizardPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].ticketSetupWizardPanel.channelId).catch(() => null);
                    if (panelChannel) {
                        panelMessage = await panelChannel.messages.fetch(cfg[gid].ticketSetupWizardPanel.messageId).catch(() => null);
                    }
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                cfg[gid].ticketSetupWizardPanel = {
                    channelId: channel.id,
                    messageId: panelMessage.id
                };
                saveConfig(cfg);
            } catch (err) {
                console.error('Ticket setup wizard panel error:', err.message || err);
                return interaction.reply({
                    content: `❌ Unable to post the ticket setup wizard panel: ${err.message || 'Unknown error'}`,
                    flags: 64
                });
            }

            return interaction.reply({
                content: `Ticket setup wizard panel posted in ${channel.toString()}.`,
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-ticket-category') {
            const category = interaction.options.getChannel('category');
            if (category.type !== ChannelType.GuildCategory) {
                return interaction.reply({
                    content: 'Please select a category channel for tickets.',
                    flags: 64
                });
            }

            cfg[gid].ticketCategory = category.id;
            saveConfig(cfg);

            return interaction.reply({
                content: `Ticket category set to ${category.name}`,
                flags: 64
            });
        }

        if (interaction.commandName === 'setup-ticket-support-role') {
            cfg[gid].ticketSupportRole = interaction.options.getRole('role').id;
            saveConfig(cfg);

            return interaction.reply({
                content: 'Fallback ticket support role set',
                flags: 64
            });
        }

        if (interaction.commandName === 'ticket-type-add') {
            const name = interaction.options.getString('name');
            const description = interaction.options.getString('description');
            const supportRoles = interaction.options.getString('support_roles') || '';
            const notifyRole = interaction.options.getRole('notify_role');

            const typeId = normalizeTicketTypeId(name);
            if (!typeId) {
                return interaction.reply({
                    content: 'Invalid ticket type name. Use letters or numbers.',
                    flags: 64
                });
            }

            cfg[gid].ticketTypes ??= {};
            if (cfg[gid].ticketTypes[typeId]) {
                return interaction.reply({
                    content: `A ticket type with that name already exists: ${name}`,
                    flags: 64
                });
            }

            cfg[gid].ticketTypes[typeId] = {
                label: name,
                description,
                supportRoleIds: parseRoleIds(supportRoles),
                notifyRoleId: notifyRole?.id || null
            };
            saveConfig(cfg);

            return interaction.reply({
                content: `Added ticket type **${name}**. Use /create-ticket-panel to publish the panel.`,
                flags: 64
            });
        }

        if (interaction.commandName === 'ticket-type-remove') {
            const name = interaction.options.getString('name');
            const typeId = normalizeTicketTypeId(name);

            if (!cfg[gid].ticketTypes?.[typeId]) {
                return interaction.reply({
                    content: `Ticket type not found: ${name}`,
                    flags: 64
                });
            }

            delete cfg[gid].ticketTypes[typeId];
            saveConfig(cfg);

            return interaction.reply({
                content: `Removed ticket type **${name}**.`,
                flags: 64
            });
        }

        if (interaction.commandName === 'ticket-types') {
            const ticketTypes = cfg[gid].ticketTypes || {};
            const entries = Object.entries(ticketTypes);

            if (!entries.length) {
                return interaction.reply({
                    content: 'No ticket types are configured yet.',
                    flags: 64
                });
            }

            return interaction.reply({
                content: entries.map(([typeId, type]) =>
                    `• **${type.label}** (${typeId})\n  ${type.description}\n  Access: ${type.supportRoleIds.length ? type.supportRoleIds.map(id => `<@&${id}>`).join(', ') : 'none'}${type.notifyRoleId ? `\n  Notify: <@&${type.notifyRoleId}>` : ''}`
                ).join('\n\n'),
                flags: 64
            });
        }

        if (interaction.commandName === 'create-ticket-panel') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const ticketTypes = cfg[gid].ticketTypes || {};

            if (!Object.keys(ticketTypes).length) {
                return interaction.reply({
                    content: 'You must configure at least one ticket type first with /ticket-type-add.',
                    flags: 64
                });
            }

            if (!channel || channel.type !== ChannelType.GuildText) {
                return interaction.reply({
                    content: 'Please select a text channel for the ticket panel.',
                    flags: 64
                });
            }

            const panelData = buildTicketPanelMessage(ticketTypes, guildCfg);
            cfg[gid].ticketPanel ??= {};

            try {
                let panelMessage = null;
                if (cfg[gid].ticketPanel.channelId && cfg[gid].ticketPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].ticketPanel.channelId).catch(() => null);
                    if (panelChannel) {
                        panelMessage = await panelChannel.messages.fetch(cfg[gid].ticketPanel.messageId).catch(() => null);
                    }
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                try {
                    if (!panelMessage.pinned) {
                        await panelMessage.pin();
                    }
                } catch (err) {
                    // ignore pin failures due to permissions
                }

                cfg[gid].ticketPanel = {
                    channelId: channel.id,
                    messageId: panelMessage.id
                };
                saveConfig(cfg);
            } catch (err) {
                console.error('Ticket panel error:', err);
                return interaction.reply({
                    content: 'Unable to post the ticket panel. Check permissions and channel settings.',
                    flags: 64
                });
            }

            return interaction.reply({
                content: `Ticket panel posted in ${channel.toString()}.`,
                flags: 64
            });
        }

        if (interaction.commandName === 'close-ticket') {
            const channel = interaction.channel;
            const supportRoleId = guildCfg?.ticketSupportRole;
            const closed = await closeTicketChannel(channel, supportRoleId);

            return interaction.reply({
                content: closed ? '✅ Ticket closed.' : 'Unable to close this channel as a ticket.',
                flags: 64
            });
        }

        if (interaction.commandName === 'verify-member') {
            const targetUser = interaction.options.getUser('member');
            const rsn = interaction.options.getString('rsn');
            const guildCfg = cfg[gid];
            const clan = guildCfg?.clan;

            if (!clan) {
                return interaction.reply({
                    content: 'Clan not set. Use /setup-clan first.',
                    flags: 64
                });
            }

            await interaction.deferReply({ flags: 64 });

            if (!(await verifyRSN(rsn))) {
                return interaction.editReply({
                    content: `❌ Could not verify RSN ${rsn}. Please check the name and try again.`
                });
            }

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return interaction.editReply({
                    content: 'Could not find that member in this server.'
                });
            }

            let inClan = false;
            let clanRank = null;
            try {
                const clanMember = await getClanMemberInfo(rsn, clan);
                if (clanMember) {
                    inClan = true;
                    clanRank = clanMember.rank;
                }
            } catch (e) {
                console.error(e);
            }

            try {
                await member.setNickname(rsn);
            } catch (err) {
                console.error('Nickname error:', err);
            }

            let addedRoleName = null;
            try {
                const memberRole = guildCfg.memberRole ? await interaction.guild.roles.fetch(guildCfg.memberRole).catch(() => null) : null;
                const guestRole = guildCfg.guestRole ? await interaction.guild.roles.fetch(guildCfg.guestRole).catch(() => null) : null;

                if (inClan && memberRole) {
                    await member.roles.add(memberRole);
                    addedRoleName = memberRole.name;
                    if (guestRole) await member.roles.remove(guestRole).catch(() => null);
                }

                if (!inClan && guestRole) {
                    await member.roles.add(guestRole);
                    addedRoleName = guestRole.name;
                    if (memberRole) await member.roles.remove(memberRole).catch(() => null);
                }
            } catch (err) {
                console.error('Role error:', err);
            }

            await removeWelcomeMessage(cfg, gid, guildCfg, member.id);

            const statusText = inClan ? `In clan **${clan}**${clanRank ? ` (rank ${clanRank})` : ''}` : `Not in clan **${clan}**`;
            const roleText = addedRoleName ? `Added role: ${addedRoleName}` : 'No role assigned yet.';

            try {
                if (guildCfg.serverLogsChannel) {
                    const logChannel = await interaction.guild.channels.fetch(guildCfg.serverLogsChannel).catch(() => null);
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setColor(inClan ? 0x00FF00 : 0xFFA500)
                            .setTitle('Manual RSN Verification')
                            .setDescription('An admin manually verified a member.')
                            .addFields(
                                { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: false },
                                { name: 'RSN', value: `**${rsn}**`, inline: true },
                                { name: 'Status', value: statusText, inline: true },
                                { name: 'Role', value: addedRoleName ? `**${addedRoleName}**` : 'No role assigned', inline: true }
                            )
                            .setTimestamp();
                        await logChannel.send({ embeds: [embed] });
                    }
                }
            } catch (err) {
                console.error('Server logs error:', err);
            }

            return interaction.editReply({
                content: inClan ?
                    `✅ ${member.user.tag} is verified and a member of ${clan}${clanRank ? ` (rank ${clanRank})` : ''}. ${roleText}` :
                    `✅ ${member.user.tag} is verified but not listed in ${clan}. ${roleText}`
            });
        }

        if (interaction.commandName === 'ticket-panel-customize') {
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');

            if (title) cfg[gid].ticketPanelTitle = title;
            if (description) cfg[gid].ticketPanelDescription = description;
            saveConfig(cfg);

            const currentTitle = cfg[gid].ticketPanelTitle || DEFAULT_TICKET_PANEL_TITLE;
            const currentDesc = cfg[gid].ticketPanelDescription || DEFAULT_TICKET_PANEL_DESC;

            return interaction.reply({
                content: `✅ Ticket panel customized:\n**Title:** ${currentTitle}\n**Description:** ${currentDesc}`,
                flags: 64
            });
        }

        if (interaction.commandName === 'ticket-type-customize') {
            const name = interaction.options.getString('name');
            const customTitle = interaction.options.getString('embed_title');
            const customMessage = interaction.options.getString('embed_message');
            const typeId = normalizeTicketTypeId(name);

            if (!cfg[gid].ticketTypes?.[typeId]) {
                return interaction.reply({
                    content: `Ticket type not found: ${name}`,
                    flags: 64
                });
            }

            if (customTitle) cfg[gid].ticketTypes[typeId].customTitle = customTitle;
            if (customMessage) cfg[gid].ticketTypes[typeId].customMessage = customMessage;
            saveConfig(cfg);

            const type = cfg[gid].ticketTypes[typeId];
            const displayTitle = type.customTitle || DEFAULT_TICKET_EMBED_TITLE;
            const displayMsg = type.customMessage || DEFAULT_TICKET_EMBED_DESC;

            return interaction.reply({
                content: `✅ Ticket type **${name}** customized:\n**Embed title:** ${displayTitle}\n**Embed message:** ${displayMsg}`,
                flags: 64
            });
        }

        if (interaction.commandName === 'reset-config') {
            // Confirm before reset
            const confirmButton = new ButtonBuilder()
                .setCustomId('confirm_reset_config')
                .setLabel('Confirm Reset')
                .setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_reset_config')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            return interaction.reply({
                content: '⚠️ **WARNING**: This will factory reset ALL bot configuration for this guild. This cannot be undone. Are you sure?',
                components: [row],
                flags: 64
            });
        }

        if (interaction.commandName === 'status') {
            return interaction.reply({
                content: '```json\n' +
                    JSON.stringify(cfg[gid] || {}, null, 2) +
                    '\n```',
                flags: 64
            });
        }
    }

    /* -------- BUTTON -------- */

    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === SETUP_WIZARD_BUTTON) {
            // Send ephemeral select menus for channels/roles and a continue button to open clan-name modal
            const welcomeChannelSelect = new ChannelSelectMenuBuilder()
                .setCustomId(SETUP_WELCOME_CHANNEL_SELECT)
                .setPlaceholder('Select welcome text channel')
                .setChannelTypes([ChannelType.GuildText])
                .setMinValues(1)
                .setMaxValues(1);

            const logsChannelSelect = new ChannelSelectMenuBuilder()
                .setCustomId(SETUP_LOGS_CHANNEL_SELECT)
                .setPlaceholder('Select optional logs channel')
                .setChannelTypes([ChannelType.GuildText])
                .setMinValues(0)
                .setMaxValues(1);

            const memberRoleSelect = new RoleSelectMenuBuilder()
                .setCustomId(SETUP_MEMBER_ROLE_SELECT)
                .setPlaceholder('Select member role')
                .setMinValues(1)
                .setMaxValues(1);

            const guestRoleSelect = new RoleSelectMenuBuilder()
                .setCustomId(SETUP_GUEST_ROLE_SELECT)
                .setPlaceholder('Select guest role')
                .setMinValues(1)
                .setMaxValues(1);

            const rows = [
                new ActionRowBuilder().addComponents(welcomeChannelSelect),
                new ActionRowBuilder().addComponents(logsChannelSelect),
                new ActionRowBuilder().addComponents(memberRoleSelect),
                new ActionRowBuilder().addComponents(guestRoleSelect),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(SETUP_WIZARD_CONTINUE)
                        .setLabel('Continue (enter clan name)')
                        .setStyle(ButtonStyle.Primary)
                )
            ];

            // initialize temp store (persist to config so restarts don't lose progress)
            const gid = interaction.guild?.id;
            const uid = interaction.user.id;
            cfg[gid].wizardTemp ??= {};
            cfg[gid].wizardTemp[uid] ??= {};
            saveConfig(cfg);

            return interaction.reply({ content: 'Select channels and roles for your clan setup, then click Continue.', components: rows, flags: 64 });
        }

        if (customId === SETUP_TICKET_WIZARD_BUTTON) {
            // Show select menus for ticket category and default support role, plus ability to pick default support roles for the type
            const categorySelect = new ChannelSelectMenuBuilder()
                .setCustomId(SETUP_TICKET_CATEGORY_SELECT)
                .setPlaceholder('Select ticket category')
                .setChannelTypes([ChannelType.GuildCategory])
                .setMinValues(1)
                .setMaxValues(1);

            const supportRoleSelect = new RoleSelectMenuBuilder()
                .setCustomId(SETUP_TICKET_SUPPORT_ROLE_SELECT)
                .setPlaceholder('Select default support role')
                .setMinValues(1)
                .setMaxValues(1);

            const typeSupportsSelect = new RoleSelectMenuBuilder()
                .setCustomId(SETUP_TICKET_TYPE_SUPPORTS_SELECT)
                .setPlaceholder('Optional support roles for initial ticket type')
                .setMinValues(0)
                .setMaxValues(5);

            const rows = [
                new ActionRowBuilder().addComponents(categorySelect),
                new ActionRowBuilder().addComponents(supportRoleSelect),
                new ActionRowBuilder().addComponents(typeSupportsSelect),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(SETUP_TICKET_WIZARD_CONTINUE)
                        .setLabel('Continue (enter ticket type)')
                        .setStyle(ButtonStyle.Primary)
                )
            ];

            const gid = interaction.guild?.id;
            const uid = interaction.user.id;
            cfg[gid].ticketWizardTemp ??= {};
            cfg[gid].ticketWizardTemp[uid] ??= { timestamp: Date.now() };
            saveConfig(cfg);

            return interaction.reply({ content: 'Select category and support roles, then click Continue.', components: rows, flags: 64 });
        }

        if (customId === SETUP_WIZARD_CONTINUE) {
            const gid = interaction.guild?.id;
            const uid = interaction.user.id;
            const stored = cfg[gid].wizardTemp?.[uid] || {};

            if (!stored.welcomeChannel || !stored.memberRole || !stored.guestRole) {
                return interaction.reply({
                    content: 'Please select the welcome channel, member role, and guest role before continuing.',
                    flags: 64
                });
            }

            // Delete the "Saved selections" message
            try {
                await interaction.message.delete().catch(() => {});
            } catch (err) {
                // ignore
            }

            const modal = new ModalBuilder()
                .setCustomId('setup_wizard_modal')
                .setTitle('Clan Setup Wizard - Name');

            const currentClan = cfg[gid]?.clan || '';
            const clanInput = new TextInputBuilder()
                .setCustomId('clan_name')
                .setLabel('Clan name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            if (currentClan) {
                clanInput.setValue(currentClan);
            }

            modal.addComponents(new ActionRowBuilder().addComponents(clanInput));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_TICKET_WIZARD_CONTINUE) {
            // Delete the "Saved selections" message
            try {
                await interaction.message.delete().catch(() => {});
            } catch (err) {
                // ignore
            }
            const gid = interaction.guild?.id;
            const uid = interaction.user.id;
            const stored = cfg[gid].ticketWizardTemp?.[uid] || {};

            if (!stored.category || !stored.defaultSupportRole) {
                return interaction.reply({
                    content: 'Please select the ticket category and default support role before continuing.',
                    flags: 64
                });
            }

            const modal = new ModalBuilder()
                .setCustomId('setup_ticket_wizard_modal')
                .setTitle('Ticket Setup - Type');

            const typeNameInput = new TextInputBuilder()
                .setCustomId('ticket_type_name')
                .setLabel('Ticket type name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const typeDescInput = new TextInputBuilder()
                .setCustomId('ticket_type_desc')
                .setLabel('Ticket description')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(typeNameInput),
                new ActionRowBuilder().addComponents(typeDescInput)
            );

            return interaction.showModal(modal);
        }

        if (customId.startsWith(TICKET_TYPE_BUTTON_PREFIX)) {
            const typeId = customId.slice(TICKET_TYPE_BUTTON_PREFIX.length);
            const ticketType = cfg[gid]?.ticketTypes?.[typeId];
            const categoryId = cfg[gid]?.ticketCategory;

            if (!ticketType || !categoryId) {
                return interaction.reply({
                    content: 'That ticket type is no longer available or the ticket system is not configured.',
                    flags: 64
                });
            }

            cfg[gid].ticketChannels ??= {};
            const existingTicketId = cfg[gid].ticketChannels[interaction.user.id];
            if (existingTicketId) {
                const existingChannel = await interaction.guild.channels.fetch(existingTicketId).catch(() => null);
                if (existingChannel) {
                    return interaction.reply({
                        content: `You already have an open ticket: ${existingChannel.toString()}`,
                        flags: 64
                    });
                }
                delete cfg[gid].ticketChannels[interaction.user.id];
                saveConfig(cfg);
            }

            const modal = new ModalBuilder()
                .setCustomId(`${TICKET_MODAL_PREFIX}${typeId}`)
                .setTitle(`Create ${ticketType.label}`);

            const input = new TextInputBuilder()
                .setCustomId('subject')
                .setLabel('Briefly describe your issue')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === TICKET_CLOSE_BUTTON) {
            const channel = interaction.channel;
            const supportRoleId = cfg[gid]?.ticketSupportRole;
            const closed = await closeTicketChannel(channel, supportRoleId);

            if (closed) {
                if (cfg[gid]?.ticketChannels) {
                    const ownerEntry = Object.entries(cfg[gid].ticketChannels).find(([, channelId]) => channelId === channel.id);
                    if (ownerEntry) {
                        delete cfg[gid].ticketChannels[ownerEntry[0]];
                        saveConfig(cfg);
                    }
                }
            }

            return interaction.reply({
                content: closed ? '✅ Ticket closed.' : 'Unable to close this channel as a ticket.',
                flags: 64
            });
        }

        if (customId === TICKET_DELETE_BUTTON) {
            const channel = interaction.channel;
            const ownerEntry = cfg[gid]?.ticketChannels ? Object.entries(cfg[gid].ticketChannels).find(([, channelId]) => channelId === channel.id) : null;
            const ownerId = ownerEntry ? ownerEntry[0] : null;
            const isOwner = ownerId === interaction.user.id;
            const canDelete = isOwner || interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);

            if (!canDelete) {
                return interaction.reply({
                    content: 'Only the ticket owner or a moderator can delete this ticket.',
                    flags: 64
                });
            }

            if (cfg[gid]?.ticketChannels && ownerId) {
                delete cfg[gid].ticketChannels[ownerId];
                saveConfig(cfg);
            }

            await interaction.reply({
                content: 'Deleting ticket channel...',
                flags: 64
            }).catch(() => null);

            await channel.delete('Ticket deleted by button').catch(() => null);
            return;
        }

        if (customId === 'add_rsn') {

            const guildCfg = cfg[gid];
            const messageId = interaction.message?.id;
            const welcomeEntries = guildCfg?.welcomeMessages || {};
            const targetEntry = Object.entries(welcomeEntries).find(([, value]) => value.messageId === messageId);

            if (targetEntry && targetEntry[0] !== interaction.user.id) {
                return interaction.reply({
                    content: 'This button is only for the user it was posted for. If you need access, please use your own welcome prompt or ask an admin.',
                    flags: 64
                });
            }

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

        if (customId === 'confirm_reset_config') {
            const gid = interaction.guild?.id;
            // Delete all config for this guild
            delete cfg[gid];
            saveConfig(cfg);

            return interaction.reply({
                content: '✅ Bot configuration has been factory reset for this guild. All settings have been cleared.',
                flags: 64
            });
        }

        if (customId === 'cancel_reset_config') {
            return interaction.reply({
                content: '❌ Reset cancelled.',
                flags: 64
            });
        }
    }

    /* -------- MODAL -------- */

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
        const gid = interaction.guild?.id;
        const uid = interaction.user.id;
        cfg[gid].wizardTemp ??= {};
        cfg[gid].wizardTemp[uid] ??= {};
        cfg[gid].ticketWizardTemp ??= {};
        cfg[gid].ticketWizardTemp[uid] ??= {};

        if (interaction.customId === SETUP_WELCOME_CHANNEL_SELECT) {
            cfg[gid].wizardTemp[uid].welcomeChannel = interaction.values[0];
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_LOGS_CHANNEL_SELECT) {
            cfg[gid].wizardTemp[uid].logsChannel = interaction.values[0] || null;
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_MEMBER_ROLE_SELECT) {
            cfg[gid].wizardTemp[uid].memberRole = interaction.values[0];
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_GUEST_ROLE_SELECT) {
            cfg[gid].wizardTemp[uid].guestRole = interaction.values[0];
            cfg[gid].wizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_TICKET_CATEGORY_SELECT) {
            cfg[gid].ticketWizardTemp[uid].category = interaction.values[0];
            cfg[gid].ticketWizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_TICKET_SUPPORT_ROLE_SELECT) {
            cfg[gid].ticketWizardTemp[uid].defaultSupportRole = interaction.values[0];
            cfg[gid].ticketWizardTemp[uid].timestamp = Date.now();
        }

        if (interaction.customId === SETUP_TICKET_TYPE_SUPPORTS_SELECT) {
            cfg[gid].ticketWizardTemp[uid].typeSupportRoles = interaction.values || [];
            cfg[gid].ticketWizardTemp[uid].timestamp = Date.now();
        }

        saveConfig(cfg);

        const summary = [];
        if (interaction.customId.startsWith('setup_ticket_')) {
            const stored = cfg[gid].ticketWizardTemp[uid];
            if (stored.category) summary.push(`• Category: <#${stored.category}>`);
            if (stored.defaultSupportRole) summary.push(`• Default support: <@&${stored.defaultSupportRole}>`);
            if (stored.typeSupportRoles?.length) summary.push(`• Type support roles: ${stored.typeSupportRoles.map(id => `<@&${id}>`).join(', ')}`);
        } else {
            const stored = cfg[gid].wizardTemp[uid];
            if (stored.welcomeChannel) summary.push(`• Welcome: <#${stored.welcomeChannel}>`);
            if (stored.memberRole) summary.push(`• Member role: <@&${stored.memberRole}>`);
            if (stored.guestRole) summary.push(`• Guest role: <@&${stored.guestRole}>`);
            if (stored.logsChannel) summary.push(`• Logs: <#${stored.logsChannel}>`);
        }

        return interaction.update({ content: summary.length ? `Saved selections:\n${summary.join('\n')}` : 'Selections cleared.', components: interaction.message.components, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_wizard_modal') {
        const clan = interaction.fields.getTextInputValue('clan_name').trim();
        const gid = interaction.guild?.id;
        const uid = interaction.user.id;
        const stored = cfg[gid].wizardTemp?.[uid] || {};

        const welcomeChannel = stored.welcomeChannel ? await resolveChannel(interaction.guild, `<#${stored.welcomeChannel}>`) : null;
        const memberRole = stored.memberRole ? await resolveRole(interaction.guild, `<@&${stored.memberRole}>`) : null;
        const guestRole = stored.guestRole ? await resolveRole(interaction.guild, `<@&${stored.guestRole}>`) : null;
        const logsChannel = stored.logsChannel ? await resolveChannel(interaction.guild, `<#${stored.logsChannel}>`) : null;

        if (!welcomeChannel || welcomeChannel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: 'Please select a valid welcome text channel before continuing.', flags: 64 });
        }

        if (!memberRole) {
            return interaction.reply({ content: 'Please select a valid member role before continuing.', flags: 64 });
        }

        if (!guestRole) {
            return interaction.reply({ content: 'Please select a valid guest role before continuing.', flags: 64 });
        }

        cfg[gid].clan = clan;
        cfg[gid].welcomeChannel = welcomeChannel.id;
        cfg[gid].memberRole = memberRole.id;
        cfg[gid].guestRole = guestRole.id;
        if (logsChannel) cfg[gid].serverLogsChannel = logsChannel.id;
        delete cfg[gid].wizardTemp?.[uid];
        saveConfig(cfg);

        // Delete the original wizard panel message
        try {
            const panelMsg = cfg[gid].setupWizardPanel;
            if (panelMsg?.channelId && panelMsg?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panelMsg.channelId).catch(() => null);
                if (panelChannel) {
                    const msg = await panelChannel.messages.fetch(panelMsg.messageId).catch(() => null);
                    if (msg) {
                        await msg.delete().catch(() => null);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to delete setup wizard panel message:', err);
        }

        return interaction.reply({
            content: `Clan setup complete!\n• Clan: **${clan}**\n• Welcome channel: ${welcomeChannel.toString()}\n• Member role: ${memberRole.toString()}\n• Guest role: ${guestRole.toString()}${logsChannel ? `\n• Logs channel: ${logsChannel.toString()}` : ''}`,
            flags: 64
        });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_ticket_wizard_modal') {
        const typeName = interaction.fields.getTextInputValue('ticket_type_name').trim();
        const typeDesc = interaction.fields.getTextInputValue('ticket_type_desc').trim();
        const gid = interaction.guild?.id;
        const uid = interaction.user.id;

        const stored = cfg[gid].ticketWizardTemp?.[uid] || {};
        const category = stored.category ? await resolveChannel(interaction.guild, `<#${stored.category}>`) : null;
        const fallbackRole = stored.defaultSupportRole ? await resolveRole(interaction.guild, `<@&${stored.defaultSupportRole}>`) : null;
        const supportRoleIds = (stored.typeSupportRoles || []).slice(0, 10);

        if (!category || category.type !== ChannelType.GuildCategory) {
            return interaction.reply({ content: 'Please select a valid ticket category before continuing.', flags: 64 });
        }

        if (!fallbackRole) {
            return interaction.reply({ content: 'Please select a valid default support role before continuing.', flags: 64 });
        }

        const typeId = normalizeTicketTypeId(typeName);
        if (!typeId) {
            return interaction.reply({ content: 'Invalid ticket type name. Use letters or numbers.', flags: 64 });
        }

        cfg[gid].ticketCategory = category.id;
        cfg[gid].ticketSupportRole = fallbackRole.id;
        cfg[gid].ticketTypes ??= {};
        cfg[gid].ticketTypes[typeId] = {
            label: typeName,
            description: typeDesc,
            supportRoleIds,
            notifyRoleId: null
        };
        // clear persisted ticket wizard temp
        delete cfg[gid].ticketWizardTemp?.[uid];
        saveConfig(cfg);

        // Edit the original panel message with rebuilt setup wizard
        try {
            const panel = cfg[gid].ticketSetupWizardPanel;
            if (panel?.channelId && panel?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel) {
                    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
                    if (panelMessage) {
                        const updatedPanelData = buildSetupTicketWizardMessage(cfg[gid]);
                        await panelMessage.edit(updatedPanelData).catch(() => null);
                    }
                }
            }
        } catch (err) {
            console.error('Edit ticket panel error:', err);
        }

        return interaction.reply({
            content: `✅ Ticket setup saved! Use /create-ticket-panel to publish the panel, or /ticket-type-add to add more types.`,
            flags: 64
        });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_MODAL_PREFIX)) {
        const typeId = interaction.customId.slice(TICKET_MODAL_PREFIX.length);
        const ticketType = cfg[gid]?.ticketTypes?.[typeId];
        const subject = interaction.fields.getTextInputValue('subject').trim();
        const guildCfg = cfg[gid];
        const categoryId = guildCfg?.ticketCategory;

        if (!ticketType || !categoryId) {
            return interaction.reply({
                content: 'That ticket type or the ticket system configuration is no longer available.',
                flags: 64
            });
        }

        cfg[gid].ticketChannels ??= {};
        const existingTicketId = cfg[gid].ticketChannels[interaction.user.id];
        if (existingTicketId) {
            const existingChannel = await interaction.guild.channels.fetch(existingTicketId).catch(() => null);
            if (existingChannel) {
                return interaction.reply({
                    content: `You already have an open ticket: ${existingChannel.toString()}`,
                    flags: 64
                });
            }

            delete cfg[gid].ticketChannels[interaction.user.id];
            saveConfig(cfg);
        }

        const supportRoleIds = [
            ...(ticketType.supportRoleIds || []),
            ...(guildCfg?.ticketSupportRole ? [guildCfg.ticketSupportRole] : [])
        ].filter(Boolean);

        const ticketName = normalizeTicketName(interaction.user.username);
        const ticketChannel = await createTicketChannel(
            interaction.guild,
            categoryId,
            ticketName,
            interaction.user,
            supportRoleIds
        );

        if (!ticketChannel) {
            return interaction.reply({
                content: 'Unable to create a ticket channel. Check ticket category and permissions.',
                flags: 64
            });
        }

        cfg[gid].ticketChannels[interaction.user.id] = ticketChannel.id;
        saveConfig(cfg);

        const ticketButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(TICKET_CLOSE_BUTTON)
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(TICKET_DELETE_BUTTON)
                .setLabel('Delete Ticket')
                .setStyle(ButtonStyle.Secondary)
        );

        await ticketChannel.send({
            content: `${ticketType.notifyRoleId ? `<@&${ticketType.notifyRoleId}> ` : ''}A new **${ticketType.label}** ticket has been opened by <@${interaction.user.id}>.\nSubject: ${subject}`,
            embeds: [buildTicketEmbed(interaction.user, subject, supportRoleIds, ticketType.label, ticketType.notifyRoleId, ticketType.customTitle, ticketType.customMessage)],
            components: [ticketButtons]
        }).catch(() => null);

        return interaction.reply({
            content: `✅ Your ticket has been opened: ${ticketChannel.toString()}`,
            flags: 64
        });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'rsn_modal') {

        const rsn = interaction.fields.getTextInputValue('rsn');

        const guildCfg = cfg[gid];
        const clan = guildCfg?.clan;

        if (!clan) {
            return interaction.reply({
                content: 'Clan not set. Use /setup-clan',
                flags: 64
            });
        }

        const searchingMessage = guildCfg.searchingMessage || DEFAULT_SEARCHING_MESSAGE;
        await interaction.reply({
            content: searchingMessage,
            flags: 64
        });

        /* check RSN */
        if (!(await verifyRSN(rsn))) {
            return interaction.editReply({
                content: `❌ Sorry, I couldn’t verify ${rsn}. Please double-check your RuneScape name and try again.`
            });
        }

        /* check clan */
        let inClan = false;
        let clanRank = null;
        try {
            const clanMember = await getClanMemberInfo(rsn, clan);
            if (clanMember) {
                inClan = true;
                clanRank = clanMember.rank;
            }
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
        let addedRoleName = null;
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (inClan && guildCfg.memberRole) {
                const role = interaction.guild.roles.cache.get(guildCfg.memberRole) ||
                    await interaction.guild.roles.fetch(guildCfg.memberRole).catch(() => null);

                if (role) {
                    await member.roles.add(role);
                    addedRoleName = role.name;
                }
            }

            if (!inClan && guildCfg.guestRole) {
                const role = interaction.guild.roles.cache.get(guildCfg.guestRole) ||
                    await interaction.guild.roles.fetch(guildCfg.guestRole).catch(() => null);

                if (role) {
                    await member.roles.add(role);
                    addedRoleName = role.name;
                }
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

        const roleText = addedRoleName ? `Added role: ${addedRoleName}` : 'No role assigned yet.';
        const welcomePrefix = DEFAULT_WELCOME_REPLY;

        try {
            if (guildCfg.serverLogsChannel) {
                const logChannel = await interaction.guild.channels.fetch(guildCfg.serverLogsChannel).catch(() => null);
                if (logChannel) {
                    const statusText = inClan ? `In clan **${clan}**${clanRank ? ` (rank ${clanRank})` : ''}` : `Not in clan **${clan}**`;
                    const embed = new EmbedBuilder()
                        .setColor(inClan ? 0x00FF00 : 0xFFA500)
                        .setTitle('RSN Verification Log')
                        .setDescription('A member updated their RuneScape name and verification status.')
                        .addFields(
                            { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
                            { name: 'RSN', value: `**${rsn}**`, inline: true },
                            { name: 'Status', value: statusText, inline: true },
                            { name: 'Role', value: addedRoleName ? `**${addedRoleName}**` : 'No role assigned', inline: true }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [embed] });
                }
            }
        } catch (err) {
            console.error('Server logs error:', err);
        }

        /* response */
        return interaction.editReply({
            content: inClan ?
                `${welcomePrefix} Your RuneScape name is verified and you are a member of ${clan}${clanRank ? ` (rank ${clanRank})` : ''}. ${roleText}` :
                `${welcomePrefix} Your RuneScape name is verified, but you are not currently listed in ${clan}. ${roleText}`
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
        .setLabel('Link with RSN')
        .setStyle(ButtonStyle.Primary)
    );

    const msg = await ch.send({
        content: `<@${member.id}> Click Link with RSN below to verify your RuneScape name and get your role.`,
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