require('dotenv').config();
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
    StringSelectMenuBuilder,
    ChannelType
} = require('discord.js');

const { loadConfig, saveConfig, cleanStaleTemp } = require('./config');
const {
    getGuildRole,
    normalizeTicketName,
    normalizeTicketTypeId,
    parseRoleIds,
    resolveChannel,
    resolveRole,
    applyMemberRoles,
    removeWelcomeMessage
} = require('./utils');
const {
    buildTicketPanelMessage,
    buildSetupWizardMessage,
    buildSetupTicketWizardMessage,
    buildTicketEmbed
} = require('./builders');
const { createTicketChannel, closeTicketChannel } = require('./ticket');
const { verifyRSN, getClanMemberInfo } = require('./rsn');
const {
    DEFAULT_SEARCHING_MESSAGE,
    DEFAULT_WELCOME_REPLY,
    DEFAULT_TICKET_PANEL_TITLE,
    DEFAULT_TICKET_PANEL_DESC,
    DEFAULT_TICKET_EMBED_TITLE,
    DEFAULT_TICKET_EMBED_DESC,
    TICKET_TYPE_BUTTON_PREFIX,
    TICKET_CLOSE_BUTTON,
    TICKET_DELETE_BUTTON,
    TICKET_MODAL_PREFIX,
    SETUP_WIZARD_BUTTON,
    SETUP_TICKET_WIZARD_BUTTON,
    SETUP_TICKET_CATEGORY_SELECT,
    SETUP_TICKET_WIZARD_CONTINUE,
    SETUP_WELCOME_CHANNEL_SELECT,
    SETUP_MEMBER_ROLE_SELECT,
    SETUP_GUEST_ROLE_SELECT,
    SETUP_LOGS_CHANNEL_SELECT,
    SETUP_WIZARD_CONTINUE,
    TICKET_MANAGE_CUSTOMIZE_TYPE_SELECT,
    TICKET_MANAGE_CUSTOMIZE_TYPE_MODAL_PREFIX,
    TICKET_MANAGE_ADD_TYPE,
    TICKET_MANAGE_SET_CATEGORY,
    TICKET_MANAGE_CUSTOMIZE_TYPE,
    TICKET_MANAGE_CUSTOMIZE_PANEL,
    TICKET_MANAGE_VIEW_TYPES,
    TICKET_CLAIM_BUTTON,
    TICKET_ADD_TYPE_CONTINUE,
    TICKET_MANAGE_ADD_TYPE_MODAL
} = require('./constants');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const getGuildConfig = (cfg, gid) => {
    if (!gid) return null;
    if (!cfg[gid]) cfg[gid] = {};
    return cfg[gid];
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

client.once('ready', async () => {
    const commands = [
        new SlashCommandBuilder()
            .setName('setup-channel')
            .setDescription('Set welcome channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-clan')
            .setDescription('Set clan name')
            .addStringOption(o => o.setName('clan').setDescription('Clan').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-member-role')
            .setDescription('Role for clan members')
            .addRoleOption(o => o.setName('role').setDescription('Member role').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-guest-role')
            .setDescription('Role for non-clan members')
            .addRoleOption(o => o.setName('role').setDescription('Guest role').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-server-logs')
            .setDescription('Set the server logs channel')
            .addChannelOption(o => o.setName('channel').setDescription('Server logs channel').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-wizard')
            .setDescription('Create or refresh a fixed clan setup panel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to post the setup panel in').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-ticket-wizard')
            .setDescription('Create or refresh a fixed ticket setup panel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to post the ticket setup panel in').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-ticket-category')
            .setDescription('Set the ticket category for new tickets')
            .addChannelOption(o => o.setName('category').setDescription('Ticket category channel').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('ticket-type-add')
            .setDescription('Add a ticket type for the ticket panel')
            .addStringOption(o => o.setName('name').setDescription('Ticket type name').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('Short description for this ticket type').setRequired(true))
            .addStringOption(o => o.setName('access_roles').setDescription('Comma-separated role mentions/IDs that have access to this ticket type').setRequired(false))
            .addRoleOption(o => o.setName('notify_role').setDescription('Optional role to mention in the ticket channel').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('ticket-type-remove')
            .setDescription('Remove a configured ticket type')
            .addStringOption(o => o.setName('name').setDescription('Ticket type name to remove').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('ticket-types')
            .setDescription('List configured ticket types')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('create-ticket-panel')
            .setDescription('Post or refresh the ticket type panel in this channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to post the ticket panel in').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('verify-member')
            .setDescription('Verify a member using their RSN and update nickname/roles')
            .addUserOption(o => o.setName('member').setDescription('The member to verify').setRequired(true))
            .addStringOption(o => o.setName('rsn').setDescription('The RuneScape name to verify').setRequired(true))
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
            .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(false))
            .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('ticket-type-customize')
            .setDescription('Customize the embed title and message for a ticket type')
            .addStringOption(o => o.setName('name').setDescription('Ticket type name').setRequired(true))
            .addStringOption(o => o.setName('embed_title').setDescription('Custom embed title (use {type} for ticket type name)').setRequired(false))
            .addStringOption(o => o.setName('embed_message').setDescription('Custom embed description (use {subject} for issue subject)').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Show config')
    ];

    await client.application.commands.set(commands.map(c => c.toJSON()));
    console.log('Ready as', client.user.tag);

    const cfg = loadConfig();
    if (cleanStaleTemp(cfg)) saveConfig(cfg);
    setInterval(() => {
        const c = loadConfig();
        if (cleanStaleTemp(c)) saveConfig(c);
    }, 1000 * 60 * 60 * 24);
});

client.on('interactionCreate', async interaction => {
    const cfg = loadConfig();
    const gid = interaction.guild?.id;
    const guildCfg = getGuildConfig(cfg, gid);

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-channel') {
            cfg[gid].welcomeChannel = interaction.options.getChannel('channel').id;
            saveConfig(cfg);
            return interaction.reply({ content: 'Welcome channel set', flags: 64 });
        }

        if (interaction.commandName === 'setup-clan') {
            cfg[gid].clan = interaction.options.getString('clan');
            saveConfig(cfg);
            return interaction.reply({ content: `Clan set: ${cfg[gid].clan}`, flags: 64 });
        }

        if (interaction.commandName === 'setup-member-role') {
            cfg[gid].memberRole = interaction.options.getRole('role').id;
            saveConfig(cfg);
            return interaction.reply({ content: 'Member role set', flags: 64 });
        }

        if (interaction.commandName === 'setup-guest-role') {
            cfg[gid].guestRole = interaction.options.getRole('role').id;
            saveConfig(cfg);
            return interaction.reply({ content: 'Guest role set', flags: 64 });
        }

        if (interaction.commandName === 'setup-server-logs') {
            cfg[gid].serverLogsChannel = interaction.options.getChannel('channel').id;
            saveConfig(cfg);
            return interaction.reply({ content: 'Server logs channel set', flags: 64 });
        }

        if (interaction.commandName === 'setup-wizard') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            if (!channel || !channel.isTextBased() || channel.isThread()) {
                return interaction.reply({ content: 'Please choose a text channel to post the setup panel in.', flags: 64 });
            }

            const botMember = await interaction.guild.members.fetchMe().catch(() => null);
            if (botMember) {
                const perms = channel.permissionsFor(botMember);
                if (!perms?.has(PermissionFlagsBits.SendMessages)) {
                    return interaction.reply({ content: `❌ I don't have permission to send messages in ${channel.toString()}.`, flags: 64 });
                }
                if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ content: `❌ I don't have permission to manage messages in ${channel.toString()}. (needed to pin)`, flags: 64 });
                }
            }

            const panelData = buildSetupWizardMessage(guildCfg);
            cfg[gid].setupWizardPanel ??= {};
            let panelMessage = null;

            try {
                if (cfg[gid].setupWizardPanel.channelId && cfg[gid].setupWizardPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].setupWizardPanel.channelId).catch(() => null);
                    if (panelChannel) panelMessage = await panelChannel.messages.fetch(cfg[gid].setupWizardPanel.messageId).catch(() => null);
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                cfg[gid].setupWizardPanel = { channelId: channel.id, messageId: panelMessage.id };
                saveConfig(cfg);
            } catch (err) {
                console.error('Setup wizard panel error:', err.message || err);
                return interaction.reply({ content: `❌ Unable to post the setup wizard panel: ${err.message || 'Unknown error'}`, flags: 64 });
            }

            return interaction.reply({ content: `Setup wizard panel posted in ${channel.toString()}.`, flags: 64 });
        }

        if (interaction.commandName === 'setup-ticket-wizard') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            if (!channel || !channel.isTextBased() || channel.isThread()) {
                return interaction.reply({ content: 'Please choose a text channel to post the ticket setup panel in.', flags: 64 });
            }

            const botMember = await interaction.guild.members.fetchMe().catch(() => null);
            if (botMember) {
                const perms = channel.permissionsFor(botMember);
                if (!perms?.has(PermissionFlagsBits.SendMessages)) {
                    return interaction.reply({ content: `❌ I don't have permission to send messages in ${channel.toString()}.`, flags: 64 });
                }
            }

            const panelData = buildSetupTicketWizardMessage(guildCfg);
            cfg[gid].ticketSetupWizardPanel ??= {};
            let panelMessage = null;

            try {
                if (cfg[gid].ticketSetupWizardPanel.channelId && cfg[gid].ticketSetupWizardPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].ticketSetupWizardPanel.channelId).catch(() => null);
                    if (panelChannel) panelMessage = await panelChannel.messages.fetch(cfg[gid].ticketSetupWizardPanel.messageId).catch(() => null);
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                cfg[gid].ticketSetupWizardPanel = { channelId: channel.id, messageId: panelMessage.id };
                saveConfig(cfg);
            } catch (err) {
                console.error('Ticket setup wizard panel error:', err.message || err);
                return interaction.reply({ content: `❌ Unable to post the ticket setup wizard panel: ${err.message || 'Unknown error'}`, flags: 64 });
            }

            return interaction.reply({ content: `Ticket setup wizard panel posted in ${channel.toString()}.`, flags: 64 });
        }

        if (interaction.commandName === 'setup-ticket-category') {
            const category = interaction.options.getChannel('category');
            if (category.type !== ChannelType.GuildCategory) {
                return interaction.reply({ content: 'Please select a category channel for tickets.', flags: 64 });
            }

            cfg[gid].ticketCategory = category.id;
            saveConfig(cfg);
            return interaction.reply({ content: `Ticket category set to ${category.name}`, flags: 64 });
        }

        if (interaction.commandName === 'ticket-type-add') {
            const name = interaction.options.getString('name');
            const description = interaction.options.getString('description');
            const accessRoles = interaction.options.getString('access_roles') || '';
            const notifyRole = interaction.options.getRole('notify_role');

            const typeId = normalizeTicketTypeId(name);
            if (!typeId) {
                return interaction.reply({ content: 'Invalid ticket type name. Use letters or numbers.', flags: 64 });
            }

            cfg[gid].ticketTypes ??= {};
            if (cfg[gid].ticketTypes[typeId]) {
                return interaction.reply({ content: `A ticket type with that name already exists: ${name}`, flags: 64 });
            }

            cfg[gid].ticketTypes[typeId] = {
                label: name,
                description,
                accessRoleIds: parseRoleIds(accessRoles),
                notifyRoleId: notifyRole?.id || null
            };
            saveConfig(cfg);
            return interaction.reply({ content: `Added ticket type **${name}**. Use /create-ticket-panel to publish the panel.`, flags: 64 });
        }

        if (interaction.commandName === 'ticket-type-remove') {
            const name = interaction.options.getString('name');
            const typeId = normalizeTicketTypeId(name);
            if (!cfg[gid].ticketTypes?.[typeId]) {
                return interaction.reply({ content: `Ticket type not found: ${name}`, flags: 64 });
            }

            delete cfg[gid].ticketTypes[typeId];
            saveConfig(cfg);
            return interaction.reply({ content: `Removed ticket type **${name}**.`, flags: 64 });
        }

        if (interaction.commandName === 'ticket-types') {
            const ticketTypes = cfg[gid].ticketTypes || {};
            const entries = Object.entries(ticketTypes);
            if (!entries.length) {
                return interaction.reply({ content: 'No ticket types are configured yet.', flags: 64 });
            }

            return interaction.reply({
                content: entries.map(([typeId, type]) =>
                    `• **${type.label}** (${typeId})\n  ${type.description}\n  Access: ${type.accessRoleIds.length ? type.accessRoleIds.map(id => `<@&${id}>`).join(', ') : 'none'}${type.notifyRoleId ? `\n  Notify: <@&${type.notifyRoleId}>` : ''}`
                ).join('\n\n'),
                flags: 64
            });
        }

        if (interaction.commandName === 'create-ticket-panel') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const ticketTypes = cfg[gid].ticketTypes || {};
            if (!Object.keys(ticketTypes).length) {
                return interaction.reply({ content: 'You must configure at least one ticket type first with /ticket-type-add.', flags: 64 });
            }
            if (!channel || channel.type !== ChannelType.GuildText) {
                return interaction.reply({ content: 'Please select a text channel for the ticket panel.', flags: 64 });
            }

            const panelData = buildTicketPanelMessage(ticketTypes, guildCfg);
            cfg[gid].ticketPanel ??= {};
            try {
                let panelMessage = null;
                if (cfg[gid].ticketPanel.channelId && cfg[gid].ticketPanel.messageId) {
                    const panelChannel = await interaction.guild.channels.fetch(cfg[gid].ticketPanel.channelId).catch(() => null);
                    if (panelChannel) panelMessage = await panelChannel.messages.fetch(cfg[gid].ticketPanel.messageId).catch(() => null);
                }

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                try {
                    if (!panelMessage.pinned) await panelMessage.pin();
                } catch (err) {
                    // ignore pin failures due to permissions
                }

                cfg[gid].ticketPanel = { channelId: channel.id, messageId: panelMessage.id };
                saveConfig(cfg);
            } catch (err) {
                console.error('Ticket panel error:', err);
                return interaction.reply({ content: 'Unable to post the ticket panel. Check permissions and channel settings.', flags: 64 });
            }

            return interaction.reply({ content: `Ticket panel posted in ${channel.toString()}.`, flags: 64 });
        }

        if (interaction.commandName === 'close-ticket') {
            const channel = interaction.channel;
            const closed = await closeTicketChannel(channel, null);
            return interaction.reply({ content: closed ? '✅ Ticket closed.' : 'Unable to close this channel as a ticket.', flags: 64 });
        }

        if (interaction.commandName === 'verify-member') {
            const targetUser = interaction.options.getUser('member');
            const rsn = interaction.options.getString('rsn');
            const guildCfg = cfg[gid];
            const clan = guildCfg?.clan;
            if (!clan) {
                return interaction.reply({ content: 'Clan not set. Use /setup-clan first.', flags: 64 });
            }

            await interaction.deferReply({ flags: 64 });
            if (!(await verifyRSN(rsn))) {
                return interaction.editReply({ content: `❌ Could not verify RSN ${rsn}. Please check the name and try again.` });
            }

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return interaction.editReply({ content: 'Could not find that member in this server.' });
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

            await removeWelcomeMessage(client, cfg, gid, guildCfg, member.id);
            saveConfig(cfg);

            const statusText = inClan ? `In clan **${clan}**${clanRank ? ` (rank ${clanRank})` : ''}` : `Not in clan **${clan}**`;
            const roleText = addedRoleName ? `Added role: ${addedRoleName}` : 'No role assigned yet.';

            try {
                if (guildCfg.serverLogsChannel) {
                    const logChannel = await interaction.guild.channels.fetch(guildCfg.serverLogsChannel).catch(() => null);
                    if (logChannel) {
                        const embed = buildVerificationEmbed(member, rsn, inClan, clan, clanRank, addedRoleName, 'Manual RSN Verification');
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
            return interaction.reply({ content: `✅ Ticket panel customized:\n**Title:** ${currentTitle}\n**Description:** ${currentDesc}`, flags: 64 });
        }

        if (interaction.commandName === 'ticket-type-customize') {
            const name = interaction.options.getString('name');
            const customTitle = interaction.options.getString('embed_title');
            const customMessage = interaction.options.getString('embed_message');
            const typeId = normalizeTicketTypeId(name);
            if (!cfg[gid].ticketTypes?.[typeId]) {
                return interaction.reply({ content: `Ticket type not found: ${name}`, flags: 64 });
            }

            if (customTitle) cfg[gid].ticketTypes[typeId].customTitle = customTitle;
            if (customMessage) cfg[gid].ticketTypes[typeId].customMessage = customMessage;
            saveConfig(cfg);

            const type = cfg[gid].ticketTypes[typeId];
            const displayTitle = type.customTitle || DEFAULT_TICKET_EMBED_TITLE;
            const displayMsg = type.customMessage || DEFAULT_TICKET_EMBED_DESC;
            return interaction.reply({ content: `✅ Ticket type **${name}** customized:\n**Embed title:** ${displayTitle}\n**Embed message:** ${displayMsg}`, flags: 64 });
        }

        if (interaction.commandName === 'reset-config') {
            const confirmButton = new ButtonBuilder().setCustomId('confirm_reset_config').setLabel('Confirm Reset').setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder().setCustomId('cancel_reset_config').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
            return interaction.reply({ content: '⚠️ **WARNING**: This will factory reset ALL bot configuration for this guild. This cannot be undone. Are you sure?', components: [row], flags: 64 });
        }

        if (interaction.commandName === 'status') {
            return interaction.reply({ content: '```json\n' + JSON.stringify(cfg[gid] || {}, null, 2) + '\n```', flags: 64 });
        }
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;


        if (customId === TICKET_ADD_TYPE_CONTINUE) {
            const modal = new ModalBuilder()
                .setCustomId(TICKET_MANAGE_ADD_TYPE_MODAL)
                .setTitle('Add Ticket Type');
            const nameInput = new TextInputBuilder()
                .setCustomId('ticket_type_name')
                .setLabel('Ticket type name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const descInput = new TextInputBuilder()
                .setCustomId('ticket_type_desc')
                .setLabel('Ticket description')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(descInput)
            );
            return interaction.showModal(modal);
        }        

        if (customId === SETUP_WIZARD_BUTTON) {
            const welcomeChannelSelect = new ChannelSelectMenuBuilder().setCustomId(SETUP_WELCOME_CHANNEL_SELECT).setPlaceholder('Select welcome text channel').setChannelTypes([ChannelType.GuildText]).setMinValues(1).setMaxValues(1);
            const logsChannelSelect = new ChannelSelectMenuBuilder().setCustomId(SETUP_LOGS_CHANNEL_SELECT).setPlaceholder('Select optional logs channel').setChannelTypes([ChannelType.GuildText]).setMinValues(0).setMaxValues(1);
            const memberRoleSelect = new RoleSelectMenuBuilder().setCustomId(SETUP_MEMBER_ROLE_SELECT).setPlaceholder('Select member role').setMinValues(1).setMaxValues(1);
            const guestRoleSelect = new RoleSelectMenuBuilder().setCustomId(SETUP_GUEST_ROLE_SELECT).setPlaceholder('Select guest role').setMinValues(1).setMaxValues(1);
            const rows = [
                new ActionRowBuilder().addComponents(welcomeChannelSelect),
                new ActionRowBuilder().addComponents(logsChannelSelect),
                new ActionRowBuilder().addComponents(memberRoleSelect),
                new ActionRowBuilder().addComponents(guestRoleSelect),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(SETUP_WIZARD_CONTINUE).setLabel('Continue').setStyle(ButtonStyle.Primary)
                )
            ];

            const uid = interaction.user.id;
            cfg[gid].wizardTemp ??= {};
            cfg[gid].wizardTemp[uid] ??= {};
            saveConfig(cfg);
            return interaction.reply({ content: 'Select channels and roles for your clan setup, then click Continue.', components: rows, flags: 64 });
        }

        if (customId === SETUP_TICKET_WIZARD_BUTTON || customId === SETUP_TICKET_WIZARD_CONTINUE) {
            return interaction.reply({ content: 'Ticket setup now uses the button panel directly. Re-post the ticket setup wizard panel with /setup-ticket-wizard to refresh it and configure using the buttons.', flags: 64 });
        }

        if (customId === SETUP_WIZARD_CONTINUE) {
            const uid = interaction.user.id;
            const stored = cfg[gid].wizardTemp?.[uid] || {};
            if (!stored.welcomeChannel || !stored.memberRole || !stored.guestRole) {
                return interaction.reply({ content: 'Please select the welcome channel, member role, and guest role before continuing.', flags: 64 });
            }

            try { await interaction.deleteReply().catch(() => {}); } catch (err) { }

            const modal = new ModalBuilder().setCustomId('setup_wizard_modal').setTitle('Clan Setup Wizard - Name');
            const currentClan = cfg[gid]?.clan || '';
            const clanInput = new TextInputBuilder().setCustomId('clan_name').setLabel('Clan name').setStyle(TextInputStyle.Short).setRequired(true);
            if (currentClan) clanInput.setValue(currentClan);
            modal.addComponents(new ActionRowBuilder().addComponents(clanInput));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_TICKET_WIZARD_CONTINUE) {
            return interaction.reply({ content: 'Ticket setup now uses the button panel directly. Re-post the ticket setup wizard panel with /setup-ticket-wizard to refresh it and configure using the buttons.', flags: 64 });
        }

        if (customId.startsWith(TICKET_TYPE_BUTTON_PREFIX)) {
            const typeId = customId.slice(TICKET_TYPE_BUTTON_PREFIX.length);
            const ticketType = cfg[gid]?.ticketTypes?.[typeId];
            const categoryId = cfg[gid]?.ticketCategory;
            if (!ticketType || !categoryId) {
                return interaction.reply({ content: 'That ticket type is no longer available or the ticket system is not configured.', flags: 64 });
            }

            cfg[gid].ticketChannels ??= {};
            const existingTicketId = cfg[gid].ticketChannels[interaction.user.id];
            if (existingTicketId) {
                const existingChannel = await interaction.guild.channels.fetch(existingTicketId).catch(() => null);
                if (existingChannel) {
                    return interaction.reply({ content: `You already have an open ticket: ${existingChannel.toString()}`, flags: 64 });
                }
                delete cfg[gid].ticketChannels[interaction.user.id];
                saveConfig(cfg);
            }

            const modal = new ModalBuilder().setCustomId(`${TICKET_MODAL_PREFIX}${typeId}`).setTitle(`Create ${ticketType.label}`);
            const input = new TextInputBuilder().setCustomId('subject').setLabel('Briefly describe your issue').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === TICKET_CLOSE_BUTTON) {
            const channel = interaction.channel;
            const closed = await closeTicketChannel(channel, null);
            if (closed && cfg[gid]?.ticketChannels) {
                const ownerEntry = Object.entries(cfg[gid].ticketChannels).find(([, channelId]) => channelId === channel.id);
                if (ownerEntry) {
                    delete cfg[gid].ticketChannels[ownerEntry[0]];
                    saveConfig(cfg);
                }
            }
            return interaction.reply({ content: closed ? '✅ Ticket closed.' : 'Unable to close this channel as a ticket.', flags: 64 });
        }

        if (customId === TICKET_DELETE_BUTTON) {
            const channel = interaction.channel;
            const ownerEntry = cfg[gid]?.ticketChannels ? Object.entries(cfg[gid].ticketChannels).find(([, channelId]) => channelId === channel.id) : null;
            const ownerId = ownerEntry ? ownerEntry[0] : null;
            const isOwner = ownerId === interaction.user.id;
            const canDelete = isOwner || interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
            if (!canDelete) {
                return interaction.reply({ content: 'Only the ticket owner or a moderator can delete this ticket.', flags: 64 });
            }
            if (cfg[gid]?.ticketChannels && ownerId) {
                delete cfg[gid].ticketChannels[ownerId];
                saveConfig(cfg);
            }
            await interaction.reply({ content: 'Deleting ticket channel...', flags: 64 }).catch(() => null);
            await channel.delete('Ticket deleted by button').catch(() => null);
            return;
        }

        if (customId === TICKET_CLAIM_BUTTON) {
            await interaction.reply({ content: `✅ Ticket claimed by <@${interaction.user.id}>.`, flags: 64 }).catch(() => null);
            await interaction.channel.send({ content: `🔧 Ticket claimed by <@${interaction.user.id}>.` }).catch(() => null);
            return;
        }

        if (customId === TICKET_MANAGE_SET_CATEGORY) {
            const row = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId(SETUP_TICKET_CATEGORY_SELECT).setPlaceholder('Select ticket category').setChannelTypes([ChannelType.GuildCategory]).setMinValues(1).setMaxValues(1)
            );
            return interaction.reply({ content: 'Select a ticket category for new tickets.', components: [row], flags: 64 });
        }

        if (customId === TICKET_MANAGE_ADD_TYPE) {
            const uid = interaction.user.id;
            cfg[gid].addTypeTemp ??= {};
            cfg[gid].addTypeTemp[uid] = { timestamp: Date.now() };
            saveConfig(cfg);

            const accessRoleSelect = new RoleSelectMenuBuilder()
                .setCustomId('ticket_add_type_access_roles_select')
                .setPlaceholder('Select access roles (who can see this ticket type)')
                .setMinValues(0)
                .setMaxValues(10);

            const notifyRoleSelect = new RoleSelectMenuBuilder()
                .setCustomId('ticket_add_type_notify_role_select')
                .setPlaceholder('Select notify role (optional, pinged on ticket open)')
                .setMinValues(0)
                .setMaxValues(1);

            const continueBtn = new ButtonBuilder()
                .setCustomId(TICKET_ADD_TYPE_CONTINUE)
                .setLabel('Continue (enter name & description)')
                .setStyle(ButtonStyle.Primary);

            const rows = [
                new ActionRowBuilder().addComponents(accessRoleSelect),
                new ActionRowBuilder().addComponents(notifyRoleSelect),
                new ActionRowBuilder().addComponents(continueBtn)
            ];

            return interaction.reply({
                content: 'Select the roles for this ticket type, then click Continue.',
                components: rows,
                flags: 64
            });
        }

        if (customId === TICKET_MANAGE_CUSTOMIZE_TYPE) {
            const ticketTypes = cfg[gid]?.ticketTypes || {};
            const entries = Object.entries(ticketTypes);
            if (!entries.length) {
                return interaction.reply({ content: 'No ticket types are configured yet. Add one first.', flags: 64 });
            }
            const options = entries.map(([typeId, type]) => ({ label: type.label || typeId, value: typeId, description: type.description?.slice(0, 100) || undefined }));
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(TICKET_MANAGE_CUSTOMIZE_TYPE_SELECT).setPlaceholder('Select a ticket type to customize').setMinValues(1).setMaxValues(1).addOptions(options)
            );
            return interaction.reply({ content: 'Choose the ticket type you want to customize.', components: [row], flags: 64 });
        }

        if (customId === TICKET_MANAGE_CUSTOMIZE_PANEL) {
            const modal = new ModalBuilder().setCustomId('ticket_manage_customize_panel_modal').setTitle('Customize Ticket Panel');
            const titleInput = new TextInputBuilder().setCustomId('ticket_panel_title').setLabel('Panel title').setStyle(TextInputStyle.Short).setRequired(false);
            const descInput = new TextInputBuilder().setCustomId('ticket_panel_description').setLabel('Panel description').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(descInput));
            return interaction.showModal(modal);
        }

        if (customId === TICKET_MANAGE_VIEW_TYPES) {
            const ticketTypes = cfg[gid]?.ticketTypes || {};
            const entries = Object.entries(ticketTypes);
            if (!entries.length) {
                return interaction.reply({ content: 'No ticket types are configured yet. Use the wizard or /ticket-type-add to create one.', flags: 64 });
            }
            return interaction.reply({ content: entries.map(([typeId, type]) => `• **${type.label}** (${typeId})\n  ${type.description}\n  Access: ${type.accessRoleIds.length ? type.accessRoleIds.map(id => `<@&${id}>`).join(', ') : 'none'}${type.notifyRoleId ? `\n  Notify: <@&${type.notifyRoleId}>` : ''}`).join('\n\n'), flags: 64 });
        }

        if (customId === 'add_rsn') {
            const messageId = interaction.message?.id;
            const welcomeEntries = guildCfg?.welcomeMessages || {};
            const targetEntry = Object.entries(welcomeEntries).find(([, value]) => value.messageId === messageId);
            if (targetEntry && targetEntry[0] !== interaction.user.id) {
                return interaction.reply({ content: 'This button is only for the user it was posted for. If you need access, please use your own welcome prompt or ask an admin.', flags: 64 });
            }
            const modal = new ModalBuilder().setCustomId('rsn_modal').setTitle('Add RSN');
            const input = new TextInputBuilder().setCustomId('rsn').setLabel('RuneScape Name').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === 'confirm_reset_config') {
            delete cfg[gid];
            saveConfig(cfg);
            return interaction.reply({ content: '✅ Bot configuration has been factory reset for this guild. All settings have been cleared.', flags: 64 });
        }

        if (customId === 'cancel_reset_config') {
            return interaction.reply({ content: '❌ Reset cancelled.', flags: 64 });
        }
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isStringSelectMenu()) {
        const uid = interaction.user.id;
        cfg[gid].wizardTemp ??= {};
        cfg[gid].wizardTemp[uid] ??= {};
        cfg[gid].ticketWizardTemp ??= {};
        cfg[gid].ticketWizardTemp[uid] ??= {};

        if (interaction.customId === 'ticket_add_type_access_roles_select') {
            cfg[gid].addTypeTemp ??= {};
            cfg[gid].addTypeTemp[uid] ??= {};
            cfg[gid].addTypeTemp[uid].accessRoleIds = interaction.values;
            cfg[gid].addTypeTemp[uid].timestamp = Date.now();
            saveConfig(cfg);
            return interaction.update({ components: interaction.message.components });
        }

        if (interaction.customId === 'ticket_add_type_notify_role_select') {
            cfg[gid].addTypeTemp ??= {};
            cfg[gid].addTypeTemp[uid] ??= {};
            cfg[gid].addTypeTemp[uid].notifyRoleId = interaction.values[0] || null;
            cfg[gid].addTypeTemp[uid].timestamp = Date.now();
            saveConfig(cfg);
            return interaction.update({ components: interaction.message.components });
        }

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
            cfg[gid].ticketCategory = interaction.values[0];
            saveConfig(cfg);
            const panel = cfg[gid].ticketSetupWizardPanel;
            if (panel?.channelId && panel?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel) {
                    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
                    if (panelMessage) await panelMessage.edit(buildSetupTicketWizardMessage(cfg[gid])).catch(() => null);
                }
            }
        }

        if (interaction.customId === TICKET_MANAGE_CUSTOMIZE_TYPE_SELECT) {
            const typeId = interaction.values[0];
            const ticketType = cfg[gid]?.ticketTypes?.[typeId];
            if (!ticketType) {
                return interaction.reply({ content: 'Selected ticket type not found.', flags: 64 });
            }
            const modal = new ModalBuilder().setCustomId(`${TICKET_MANAGE_CUSTOMIZE_TYPE_MODAL_PREFIX}${typeId}`).setTitle(`Customize ${ticketType.label}`);
            const titleInput = new TextInputBuilder().setCustomId('ticket_type_custom_title').setLabel('Embed title (use {type})').setStyle(TextInputStyle.Short).setRequired(false).setValue(ticketType.customTitle || '');
            const msgInput = new TextInputBuilder().setCustomId('ticket_type_custom_message').setLabel('Embed message (use {subject})').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(ticketType.customMessage || '');
            modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(msgInput));
            return interaction.showModal(modal);
        }

        saveConfig(cfg);
        return interaction.update({ components: interaction.message.components, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_wizard_modal') {
        const clan = interaction.fields.getTextInputValue('clan_name').trim();
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

        try {
            const panelMsg = cfg[gid].setupWizardPanel;
            if (panelMsg?.channelId && panelMsg?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panelMsg.channelId).catch(() => null);
                if (panelChannel) {
                    const msg = await panelChannel.messages.fetch(panelMsg.messageId).catch(() => null);
                    if (msg) {
                        const configEmbed = new EmbedBuilder()
                            .setTitle('✅ Clan Setup Configured')
                            .setDescription('Your clan configuration has been saved.')
                            .setColor(0x57F287)
                            .addFields(
                                { name: 'Clan Name', value: `**${clan}**`, inline: false },
                                { name: 'Welcome Channel', value: welcomeChannel.toString(), inline: true },
                                { name: 'Member Role', value: memberRole.toString(), inline: true },
                                { name: 'Guest Role', value: guestRole.toString(), inline: true },
                                ...(logsChannel ? [{ name: 'Logs Channel', value: logsChannel.toString(), inline: true }] : [])
                            )
                            .setFooter({ text: 'Click the button below to update your clan setup' });

                        const updateButton = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(SETUP_WIZARD_BUTTON).setLabel('Update Clan Setup').setStyle(ButtonStyle.Primary)
                        );

                        await msg.edit({ embeds: [configEmbed], components: [updateButton] }).catch(() => null);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to edit setup wizard panel message:', err);
        }

        return interaction.reply({ content: `✅ Clan setup complete!\n• Clan: **${clan}**\n• Welcome channel: ${welcomeChannel.toString()}\n• Member role: ${memberRole.toString()}\n• Guest role: ${guestRole.toString()}${logsChannel ? `\n• Logs channel: ${logsChannel.toString()}` : ''}`, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_ticket_wizard_modal') {
        const typeName = interaction.fields.getTextInputValue('ticket_type_name').trim();
        const typeDesc = interaction.fields.getTextInputValue('ticket_type_desc').trim();
        const uid = interaction.user.id;
        const stored = cfg[gid].ticketWizardTemp?.[uid] || {};
        const category = stored.category ? await resolveChannel(interaction.guild, `<#${stored.category}>`) : null;
        const accessRoleIds = (stored.typeAccessRoles || []).slice(0, 10);

        if (!category || category.type !== ChannelType.GuildCategory) {
            return interaction.reply({ content: 'Please select a valid ticket category before continuing.', flags: 64 });
        }

        const typeId = normalizeTicketTypeId(typeName);
        if (!typeId) {
            return interaction.reply({ content: 'Invalid ticket type name. Use letters or numbers.', flags: 64 });
        }

        cfg[gid].ticketCategory = category.id;
        cfg[gid].ticketTypes ??= {};
        cfg[gid].ticketTypes[typeId] = {
            label: typeName,
            description: typeDesc,
            accessRoleIds,
            notifyRoleId: null
        };
        delete cfg[gid].ticketWizardTemp?.[uid];
        saveConfig(cfg);

        try {
            const panel = cfg[gid].ticketSetupWizardPanel;
            if (panel?.channelId && panel?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel) {
                    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
                    if (panelMessage) await panelMessage.edit(buildSetupTicketWizardMessage(cfg[gid])).catch(() => null);
                }
            }
        } catch (err) {
            console.error('Edit ticket panel error:', err);
        }

        return interaction.reply({ content: '✅ Ticket setup saved! Use /create-ticket-panel to publish the panel, or /ticket-type-add to add more types.', flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'ticket_manage_add_type_modal') {
        const name = interaction.fields.getTextInputValue('ticket_type_name').trim();
        const typeDesc = interaction.fields.getTextInputValue('ticket_type_desc').trim();
        const uid = interaction.user.id;

        // Read roles saved from the select menus
        const stored = cfg[gid].addTypeTemp?.[uid] || {};
        const accessRoleIds = stored.accessRoleIds || [];
        const notifyRoleId = stored.notifyRoleId || null;
        delete cfg[gid].addTypeTemp?.[uid];

        const typeId = normalizeTicketTypeId(name);
        if (!typeId) {
            return interaction.reply({ content: 'Invalid ticket type name. Use letters or numbers.', flags: 64 });
        }

        cfg[gid].ticketTypes ??= {};
        if (cfg[gid].ticketTypes[typeId]) {
            return interaction.reply({ content: `A ticket type with that name already exists: ${name}`, flags: 64 });
        }

        cfg[gid].ticketTypes[typeId] = { label: name, description: typeDesc, accessRoleIds, notifyRoleId };
        saveConfig(cfg);

        // Delete the role-select message
        try {
            await interaction.message?.delete().catch(() => null);
        } catch (_) {}

        // Refresh the ticket setup wizard panel if present
        try {
            const panel = cfg[gid].ticketSetupWizardPanel;
            if (panel?.channelId && panel?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel) {
                    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
                    if (panelMessage) await panelMessage.edit(buildSetupTicketWizardMessage(cfg[gid])).catch(() => null);
                }
            }
        } catch (err) {
            console.error('Edit ticket panel error:', err);
        }

        return interaction.reply({ content: `✅ Added ticket type **${name}**.`, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_MANAGE_CUSTOMIZE_TYPE_MODAL_PREFIX)) {
        const typeId = interaction.customId.slice(TICKET_MANAGE_CUSTOMIZE_TYPE_MODAL_PREFIX.length);
        const ticketType = cfg[gid]?.ticketTypes?.[typeId];
        if (!ticketType) {
            return interaction.reply({ content: 'Ticket type not found.', flags: 64 });
        }

        const customTitle = interaction.fields.getTextInputValue('ticket_type_custom_title').trim();
        const customMessage = interaction.fields.getTextInputValue('ticket_type_custom_message').trim();
        if (customTitle) cfg[gid].ticketTypes[typeId].customTitle = customTitle;
        if (customMessage) cfg[gid].ticketTypes[typeId].customMessage = customMessage;
        saveConfig(cfg);

        try {
            const panel = cfg[gid].ticketSetupWizardPanel;
            if (panel?.channelId && panel?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel) {
                    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
                    if (panelMessage) await panelMessage.edit(buildSetupTicketWizardMessage(cfg[gid])).catch(() => null);
                }
            }
        } catch (err) {
            console.error('Edit ticket panel error:', err);
        }

        return interaction.reply({ content: `✅ Ticket type **${ticketType.label}** custom embed saved.`, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'ticket_manage_customize_panel_modal') {
        const title = interaction.fields.getTextInputValue('ticket_panel_title').trim();
        const description = interaction.fields.getTextInputValue('ticket_panel_description').trim();
        if (title) cfg[gid].ticketPanelTitle = title;
        if (description) cfg[gid].ticketPanelDescription = description;
        saveConfig(cfg);

        try {
            const panel = cfg[gid].ticketSetupWizardPanel;
            if (panel?.channelId && panel?.messageId) {
                const panelChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
                if (panelChannel) {
                    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
                    if (panelMessage) await panelMessage.edit(buildSetupTicketWizardMessage(cfg[gid])).catch(() => null);
                }
            }
        } catch (err) {
            console.error('Edit ticket panel error:', err);
        }

        return interaction.reply({ content: '✅ Ticket panel customization saved.', flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_MODAL_PREFIX)) {
        const typeId = interaction.customId.slice(TICKET_MODAL_PREFIX.length);
        const ticketType = cfg[gid]?.ticketTypes?.[typeId];
        const subject = interaction.fields.getTextInputValue('subject').trim();
        const categoryId = guildCfg?.ticketCategory;
        if (!ticketType || !categoryId) {
            return interaction.reply({ content: 'That ticket type or the ticket system configuration is no longer available.', flags: 64 });
        }

        cfg[gid].ticketChannels ??= {};
        const existingTicketId = cfg[gid].ticketChannels[interaction.user.id];
        if (existingTicketId) {
            const existingChannel = await interaction.guild.channels.fetch(existingTicketId).catch(() => null);
            if (existingChannel) {
                return interaction.reply({ content: `You already have an open ticket: ${existingChannel.toString()}`, flags: 64 });
            }
            delete cfg[gid].ticketChannels[interaction.user.id];
            saveConfig(cfg);
        }

        const supportRoleIds = ticketType.accessRoleIds || [];
        const ticketName = normalizeTicketName(interaction.user.username);
        const ticketChannel = await createTicketChannel(interaction.guild, categoryId, ticketName, interaction.user, supportRoleIds);
        if (!ticketChannel) {
            return interaction.reply({ content: 'Unable to create a ticket channel. Check ticket category and permissions.', flags: 64 });
        }

        cfg[gid].ticketChannels[interaction.user.id] = ticketChannel.id;
        saveConfig(cfg);

        const ticketButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(TICKET_CLAIM_BUTTON).setLabel('Claim Ticket').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(TICKET_CLOSE_BUTTON).setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(TICKET_DELETE_BUTTON).setLabel('Delete Ticket').setStyle(ButtonStyle.Secondary)
        );

        const supportRoleNames = [];
        for (const roleId of supportRoleIds) {
            const role = await getGuildRole(interaction.guild, roleId);
            supportRoleNames.push(role ? role.name : roleId);
        }

        await ticketChannel.send({
            content: `${ticketType.notifyRoleId ? `<@&${ticketType.notifyRoleId}> ` : ''}A new **${ticketType.label}** ticket has been opened by <@${interaction.user.id}>.\nSubject: ${subject}`,
            embeds: [buildTicketEmbed(interaction.user, subject, supportRoleNames, ticketType.label, ticketType.notifyRoleId, ticketType.customTitle, ticketType.customMessage)],
            components: [ticketButtons]
        }).catch(() => null);

        return interaction.reply({ content: `✅ Your ticket has been opened: ${ticketChannel.toString()}`, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'rsn_modal') {
        const rsn = interaction.fields.getTextInputValue('rsn');
        const clan = guildCfg?.clan;
        if (!clan) {
            return interaction.reply({ content: 'Clan not set. Use /setup-clan', flags: 64 });
        }

        await interaction.reply({ content: DEFAULT_SEARCHING_MESSAGE, flags: 64 });
        if (!(await verifyRSN(rsn))) {
            return interaction.editReply({ content: `❌ Sorry, I couldn’t verify ${rsn}. Please double-check your RuneScape name and try again.` });
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
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.setNickname(rsn);
        } catch (err) {
            console.error('Nickname error:', err);
        }

        let addedRoleName = null;
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            if (inClan && guildCfg.memberRole) {
                const role = interaction.guild.roles.cache.get(guildCfg.memberRole) || await interaction.guild.roles.fetch(guildCfg.memberRole).catch(() => null);
                if (role) {
                    await member.roles.add(role);
                    addedRoleName = role.name;
                }
            }
            if (!inClan && guildCfg.guestRole) {
                const role = interaction.guild.roles.cache.get(guildCfg.guestRole) || await interaction.guild.roles.fetch(guildCfg.guestRole).catch(() => null);
                if (role) {
                    await member.roles.add(role);
                    addedRoleName = role.name;
                }
            }
        } catch (err) {
            console.error('Role error:', err);
        }

        try {
            await removeWelcomeMessage(client, cfg, gid, guildCfg, interaction.user.id);
            saveConfig(cfg);
        } catch (err) {
            console.error('Delete welcome error:', err);
        }

        const roleText = addedRoleName ? `Added role: ${addedRoleName}` : 'No role assigned yet.';
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

        return interaction.editReply({ content: inClan ? `${DEFAULT_WELCOME_REPLY} Your RuneScape name is verified and you are a member of ${clan}${clanRank ? ` (rank ${clanRank})` : ''}. ${roleText}` : `${DEFAULT_WELCOME_REPLY} Your RuneScape name is verified, but you are not currently listed in ${clan}. ${roleText}` });
    }
});

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


client.login(process.env.DISCORD_TOKEN).catch(err => console.error('Login failed:', err));