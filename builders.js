const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const {
    SETUP_WIZARD_BUTTON
} = require('./constants');

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

module.exports = {
    buildSetupWizardMessage
};