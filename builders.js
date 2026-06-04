const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const {
    DEFAULT_TICKET_PANEL_TITLE,
    DEFAULT_TICKET_PANEL_DESC,
    DEFAULT_TICKET_EMBED_TITLE,
    DEFAULT_TICKET_EMBED_DESC,
    TICKET_TYPE_BUTTON_PREFIX,
    TICKET_MANAGE_SET_CATEGORY,
    TICKET_MANAGE_ADD_TYPE,
    TICKET_MANAGE_CUSTOMIZE_TYPE,
    TICKET_MANAGE_CUSTOMIZE_PANEL,
    TICKET_MANAGE_VIEW_TYPES,
    SETUP_WIZARD_BUTTON
} = require('./constants');

const chunkArray = (items, size) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
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
    const buttons = [
        new ButtonBuilder()
            .setCustomId(TICKET_MANAGE_SET_CATEGORY)
            .setLabel('Set Ticket Category')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(TICKET_MANAGE_ADD_TYPE)
            .setLabel('Add Ticket Type')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(TICKET_MANAGE_CUSTOMIZE_TYPE)
            .setLabel('Customize Ticket Info')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(TICKET_MANAGE_CUSTOMIZE_PANEL)
            .setLabel('Customize Panel')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(TICKET_MANAGE_VIEW_TYPES)
            .setLabel('View Ticket Types')
            .setStyle(ButtonStyle.Secondary)
    ];

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }

    const embed = new EmbedBuilder()
        .setTitle('Ticket Setup')
        .setDescription('Use the buttons below to configure the ticket system. Set the ticket category, add ticket types with their own access roles, and customize what users see when creating a ticket.')
        .setColor(0x57F287)
        .addFields(
            { name: 'Category', value: guildCfg.ticketCategory ? `<#${guildCfg.ticketCategory}>` : 'Not set', inline: true },
            { name: 'Ticket Types', value: guildCfg.ticketTypes ? Object.keys(guildCfg.ticketTypes).length.toString() : '0', inline: true }
        );

    return {
        embeds: [embed],
        components: rows
    };
};

const buildTicketEmbed = (member, subject, supportRoleNames, typeLabel, notifyRoleId, customTitle = null, customMsg = null) => {
    const title = customTitle?.replace('{type}', typeLabel) || DEFAULT_TICKET_EMBED_TITLE.replace('{type}', typeLabel);
    const description = customMsg?.replace('{subject}', subject) || DEFAULT_TICKET_EMBED_DESC.replace('{subject}', subject);
    const supportAccess = supportRoleNames?.length ? supportRoleNames.join(', ') : 'No support roles configured';

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

module.exports = {
    buildTicketPanelMessage,
    buildSetupWizardMessage,
    buildSetupTicketWizardMessage,
    buildTicketEmbed
};