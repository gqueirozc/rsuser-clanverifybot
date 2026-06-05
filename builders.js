const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const {
    SETUP_WIZARD_BUTTON,
    SETUP_WELCOME_MESSAGE_BUTTON,
    SETUP_WELCOME_IMAGE_BUTTON
} = require('./constants');

const buildSetupWizardMessage = (guildCfg = {}) => {
    const isConfigured = guildCfg.clan && guildCfg.welcomeChannel && guildCfg.memberRole && guildCfg.guestRole;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETUP_WIZARD_BUTTON)
            .setLabel(isConfigured ? 'Update Clan Setup' : 'Start Clan Setup Wizard')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(SETUP_WELCOME_MESSAGE_BUTTON)
            .setLabel('Set Welcome Message')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(SETUP_WELCOME_IMAGE_BUTTON)
            .setLabel(guildCfg.welcomeImage ? 'Update Welcome Image' : 'Set Welcome Image')
            .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
        .setTitle('Clan Setup Wizard')
        .setColor(0x00B0F4);

    if (isConfigured) {
        embed
            .setDescription('Your clan is configured. Use the buttons below to update any settings.')
            .addFields(
                { name: '⚙️ Clan Name', value: `**${guildCfg.clan}**`, inline: true },
                { name: '📨 Welcome Channel', value: `<#${guildCfg.welcomeChannel}>`, inline: true },
                { name: '👤 Member Role', value: `<@&${guildCfg.memberRole}>`, inline: true },
                { name: '🧑‍🤝‍🧑 Guest Role', value: `<@&${guildCfg.guestRole}>`, inline: true },
                { name: '📋 Logs Channel', value: guildCfg.serverLogsChannel ? `<#${guildCfg.serverLogsChannel}>` : '*Not set*', inline: true },
                { name: '💬 Welcome Message', value: guildCfg.welcomeMessage || '*Not set — using default*', inline: false },
                { name: '🖼️ Welcome Image', value: guildCfg.welcomeImage ? '✅ Set' : '*Not set*', inline: true }
            );
    } else {
        embed
            .setDescription('Click the button below to configure your clan settings in one place. This wizard saves the clan name, welcome channel, member/guest roles, and optional log channel.')
            .addFields(
                { name: 'Step 1', value: 'Click the button to open the setup modal.', inline: false },
                { name: 'Step 2', value: 'Provide the clan name, welcome channel, member role, guest role, and optional logs channel.', inline: false },
                { name: 'Step 3', value: 'The bot will save your settings and confirm them.', inline: false }
            );
    }

    return { embeds: [embed], components: [row] };
};

module.exports = { buildSetupWizardMessage };