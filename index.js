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
    ChannelType,
    StringSelectMenuBuilder
} = require('discord.js');

const { loadConfig, saveConfig, deleteGuildConfig, cleanStaleTemp } = require('./config');
const {
    resolveChannel,
    resolveRole,
    removeWelcomeMessage
} = require('./utils');
const {
    buildSetupWizardMessage
} = require('./builders');
const { verifyRSN, getClanMemberInfo } = require('./rsn');
const {
    DEFAULT_SEARCHING_MESSAGE,
    DEFAULT_WELCOME_REPLY,
    SETUP_WIZARD_BUTTON,
    SETUP_WELCOME_CHANNEL_SELECT,
    SETUP_MEMBER_ROLE_SELECT,
    SETUP_GUEST_ROLE_SELECT,
    SETUP_LOGS_CHANNEL_SELECT,
    SETUP_WIZARD_CONTINUE,
    SETUP_WELCOME_MESSAGE_BUTTON,
    SETUP_WELCOME_IMAGE_BUTTON,
    SETUP_WIZARD_EDIT_SELECT,
    SETUP_MEMBER_REPLY_BUTTON,
    SETUP_GUEST_REPLY_BUTTON 
} = require('./constants');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const getGuildConfig = (cfg, gid) => {
    if (!gid) return null;
    if (!cfg[gid]) cfg[gid] = {};
    return cfg[gid];
};

const buildVerificationReply = (guildCfg, inClan, clan, clanRank, addedRoleName, userId) => {
    const roleText = addedRoleName ? `Added role: **${addedRoleName}**` : 'No role assigned yet.';

    if (inClan) {
        if (guildCfg.memberReply) {
            return guildCfg.memberReply
                .replace('{user}', `<@${userId}>`)
                .replace('{clan}', clan)
                .replace('{rank}', clanRank || 'N/A')
                .replace('{role}', addedRoleName || 'None');
        }
        return `✅ Welcome! Your RSN is verified and you are a member of **${clan}**${clanRank ? ` (rank ${clanRank})` : ''}. ${roleText}`;
    } else {
        if (guildCfg.guestReply) {
            return guildCfg.guestReply
                .replace('{user}', `<@${userId}>`)
                .replace('{clan}', clan)
                .replace('{role}', addedRoleName || 'None');
        }
        return `✅ Welcome! Your RSN is verified but you are not currently listed in **${clan}**. ${roleText}`;
    }
};

const refreshSetupWizardPanel = async (guild, cfg, gid) => {
    const panel = cfg[gid].setupWizardPanel;
    if (!panel?.channelId || !panel?.messageId) return;
    const panelChannel = await guild.channels.fetch(panel.channelId).catch(() => null);
    if (!panelChannel) return;
    const panelMessage = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
    if (panelMessage) await panelMessage.edit(buildSetupWizardMessage(cfg[gid])).catch(() => null);
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
            .setName('verify-member')
            .setDescription('Verify a member using their RSN and update nickname/roles')
            .addUserOption(o => o.setName('member').setDescription('The member to verify').setRequired(true))
            .addStringOption(o => o.setName('rsn').setDescription('The RuneScape name to verify').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('reset-config')
            .setDescription('Factory reset bot configuration (clears all settings)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Show config'),
        new SlashCommandBuilder()
            .setName('setup-welcome-message')
            .setDescription('Set the message sent when a new member joins')
            .addStringOption(o => o.setName('message').setDescription('Use {user} as a placeholder for the member mention').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-welcome-image')
            .setDescription('Set an image to display in the welcome message embed')
            .addStringOption(o => o.setName('url').setDescription('Direct image URL (leave empty to remove)').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    await client.application.commands.set(commands.map(c => c.toJSON()));
    console.log('Ready as', client.user.tag);

    const cfg = await loadConfig();
    if (cleanStaleTemp(cfg)) await await saveConfig(cfg);
    setInterval(async () => {
        const c = await loadConfig();
        if (cleanStaleTemp(c)) await saveConfig(c);
    }, 1000 * 60 * 60 * 24);
});

client.on('interactionCreate', async interaction => {
    const cfg = await loadConfig();
    const gid = interaction.guild?.id;
    const guildCfg = getGuildConfig(cfg, gid);

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-channel') {
            cfg[gid].welcomeChannel = interaction.options.getChannel('channel').id;
            await saveConfig(cfg);
            return interaction.reply({ content: 'Welcome channel set', flags: 64 });
        }

        if (interaction.commandName === 'setup-welcome-message') {
            const message = interaction.options.getString('message');
            cfg[gid].welcomeMessage = message;
            await saveConfig(cfg);
            return interaction.reply({ content: `✅ Welcome message set:\n${message.replace('{user}', '@[member]')}`, flags: 64 });
        }

        if (interaction.commandName === 'setup-welcome-image') {
            const url = interaction.options.getString('url');
            if (url) {
                cfg[gid].welcomeImage = url;
                await saveConfig(cfg);
                return interaction.reply({ content: `✅ Welcome image set.`, flags: 64 });
            } else {
                delete cfg[gid].welcomeImage;
                await saveConfig(cfg);
                return interaction.reply({ content: '✅ Welcome image removed.', flags: 64 });
            }
        }

        if (interaction.commandName === 'setup-clan') {
            cfg[gid].clan = interaction.options.getString('clan');
            await saveConfig(cfg);
            return interaction.reply({ content: `Clan set: ${cfg[gid].clan}`, flags: 64 });
        }

        if (interaction.commandName === 'setup-member-role') {
            cfg[gid].memberRole = interaction.options.getRole('role').id;
            await saveConfig(cfg);
            return interaction.reply({ content: 'Member role set', flags: 64 });
        }

        if (interaction.commandName === 'setup-guest-role') {
            cfg[gid].guestRole = interaction.options.getRole('role').id;
            await saveConfig(cfg);
            return interaction.reply({ content: 'Guest role set', flags: 64 });
        }

        if (interaction.commandName === 'setup-server-logs') {
            cfg[gid].serverLogsChannel = interaction.options.getChannel('channel').id;
            await saveConfig(cfg);
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
                console.log('Panel message found:', !!panelMessage);

                if (panelMessage) {
                    await panelMessage.edit(panelData).catch(() => null);
                } else {
                    panelMessage = await channel.send(panelData);
                }

                cfg[gid].setupWizardPanel = { channelId: channel.id, messageId: panelMessage.id };
                await saveConfig(cfg);
            } catch (err) {
                console.error('Setup wizard panel error:', err.message || err);
                return interaction.reply({ content: `❌ Unable to post the setup wizard panel: ${err.message || 'Unknown error'}`, flags: 64 });
            }

            return interaction.reply({ content: `Setup wizard panel posted in ${channel.toString()}.`, flags: 64 });
        }

        if (interaction.commandName === 'verify-member') {
            const targetUser = interaction.options.getUser('member');
            const rsn = interaction.options.getString('rsn');
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
            await saveConfig(cfg);

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
                content: buildVerificationReply(guildCfg, inClan, clan, clanRank, addedRoleName, targetUser.id)
            });
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

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === SETUP_WIZARD_EDIT_SELECT) {
            const field = interaction.values[0];

            if (field === 'clan') {
                const modal = new ModalBuilder().setCustomId('setup_edit_clan_modal').setTitle('Update Clan Name');
                const input = new TextInputBuilder()
                    .setCustomId('clan_name')
                    .setLabel('Clan name')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(guildCfg.clan || '');
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }

            if (field === 'welcomeChannel' || field === 'serverLogsChannel') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(`setup_edit_channel_${field}`)
                        .setPlaceholder(`Select new ${field === 'welcomeChannel' ? 'welcome' : 'logs'} channel`)
                        .setChannelTypes([ChannelType.GuildText])
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                return interaction.reply({ content: 'Select the new channel:', components: [row], flags: 64 });
            }

            if (field === 'memberRole' || field === 'guestRole') {
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId(`setup_edit_role_${field}`)
                        .setPlaceholder(`Select new ${field === 'memberRole' ? 'member' : 'guest'} role`)
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                return interaction.reply({ content: 'Select the new role:', components: [row], flags: 64 });
            }
        }
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === SETUP_WIZARD_BUTTON) {
            const isConfigured = guildCfg.clan && guildCfg.welcomeChannel && guildCfg.memberRole && guildCfg.guestRole;

            if (isConfigured) {
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(SETUP_WIZARD_EDIT_SELECT)
                        .setPlaceholder('What do you want to update?')
                        .addOptions([
                            { label: 'Clan Name', value: 'clan', description: `Currently: ${guildCfg.clan}` },
                            { label: 'Welcome Channel', value: 'welcomeChannel', description: 'Change the welcome channel' },
                            { label: 'Member Role', value: 'memberRole', description: 'Change the member role' },
                            { label: 'Guest Role', value: 'guestRole', description: 'Change the guest role' },
                            { label: 'Logs Channel', value: 'serverLogsChannel', description: 'Change the logs channel' },
                        ])
                );
                return interaction.reply({ content: 'What would you like to update?', components: [row], flags: 64 });
            }

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
            await saveConfig(cfg);
            return interaction.reply({ content: 'Select channels and roles for your clan setup, then click Continue.', components: rows, flags: 64 });
        }

        if (customId === SETUP_WELCOME_MESSAGE_BUTTON) {
            const modal = new ModalBuilder()
                .setCustomId('setup_welcome_message_modal')
                .setTitle('Set Welcome Message');
            const input = new TextInputBuilder()
                .setCustomId('welcome_message')
                .setLabel('Message (use {user} for the member mention)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(guildCfg.welcomeMessage || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_MEMBER_REPLY_BUTTON) {
            const modal = new ModalBuilder()
                .setCustomId('setup_member_reply_modal')
                .setTitle('Set Member Verified Reply');
            const input = new TextInputBuilder()
                .setCustomId('member_reply')
                .setLabel('Available: {user} {clan} {rank} {role}')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(guildCfg.memberReply || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_GUEST_REPLY_BUTTON) {
            const modal = new ModalBuilder()
                .setCustomId('setup_guest_reply_modal')
                .setTitle('Set Guest Verified Reply');
            const input = new TextInputBuilder()
                .setCustomId('guest_reply')
                .setLabel('Available: {user} {clan} {role}')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(guildCfg.guestReply || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (customId === SETUP_WELCOME_IMAGE_BUTTON) {
            const modal = new ModalBuilder()
                .setCustomId('setup_welcome_image_modal')
                .setTitle('Set Welcome Image');
            const input = new TextInputBuilder()
                .setCustomId('welcome_image_url')
                .setLabel('Direct image URL (leave blank to remove)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setValue(guildCfg.welcomeImage || '');
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
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
            await deleteGuildConfig(gid);
            return interaction.reply({ content: '✅ Bot configuration has been factory reset for this guild. All settings have been cleared.', flags: 64 });
        }

        if (customId === 'cancel_reset_config') {
            return interaction.reply({ content: '❌ Reset cancelled.', flags: 64 });
        }
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
        const uid = interaction.user.id;
        cfg[gid].wizardTemp ??= {};
        cfg[gid].wizardTemp[uid] ??= {};

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

        await saveConfig(cfg);
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
        await saveConfig(cfg);

        await refreshSetupWizardPanel(interaction.guild, cfg, gid);

        return interaction.reply({ content: `✅ Clan setup complete!\n• Clan: **${clan}**\n• Welcome channel: ${welcomeChannel.toString()}\n• Member role: ${memberRole.toString()}\n• Guest role: ${guestRole.toString()}${logsChannel ? `\n• Logs channel: ${logsChannel.toString()}` : ''}`, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_member_reply_modal') {
        const reply = interaction.fields.getTextInputValue('member_reply').trim();
        if (reply) {
            cfg[gid].memberReply = reply;
        } else {
            delete cfg[gid].memberReply;
        }
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ 
            content: reply ? `✅ Member reply updated:\n${reply}` : '✅ Member reply reset to default.', 
            flags: 64 
        });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_guest_reply_modal') {
        const reply = interaction.fields.getTextInputValue('guest_reply').trim();
        if (reply) {
            cfg[gid].guestReply = reply;
        } else {
            delete cfg[gid].guestReply;
        }
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ 
            content: reply ? `✅ Guest reply updated:\n${reply}` : '✅ Guest reply reset to default.', 
            flags: 64 
        });
    }    

    if (interaction.customId.startsWith('setup_edit_channel_')) {
        const field = interaction.customId.replace('setup_edit_channel_', '');
        cfg[gid][field] = interaction.values[0];
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.update({ content: `✅ Updated successfully.`, components: [] });
    }

    if (interaction.customId.startsWith('setup_edit_role_')) {
        const field = interaction.customId.replace('setup_edit_role_', '');
        cfg[gid][field] = interaction.values[0];
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.update({ content: `✅ Updated successfully.`, components: [] });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_edit_clan_modal') {
        const clan = interaction.fields.getTextInputValue('clan_name').trim();
        cfg[gid].clan = clan;
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ content: `✅ Clan name updated to **${clan}**.`, flags: 64 });
    }    

    if (interaction.isModalSubmit() && interaction.customId === 'rsn_modal') {
        const rsn = interaction.fields.getTextInputValue('rsn');
        const clan = guildCfg?.clan;
        if (!clan) {
            return interaction.reply({ content: 'Clan not set. Use /setup-clan', flags: 64 });
        }

        await interaction.reply({ content: DEFAULT_SEARCHING_MESSAGE, flags: 64 });
        if (!(await verifyRSN(rsn))) {
            return interaction.editReply({ content: `❌ Sorry, I couldn't verify ${rsn}. Please double-check your RuneScape name and try again.` });
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
                if (guildCfg.guestRole && member.roles.cache.has(guildCfg.guestRole)) {
                    await member.roles.remove(guildCfg.guestRole).catch(() => null);
                }
            }
            if (!inClan && guildCfg.guestRole) {
                const role = interaction.guild.roles.cache.get(guildCfg.guestRole) || await interaction.guild.roles.fetch(guildCfg.guestRole).catch(() => null);
                if (role) {
                    await member.roles.add(role);
                    addedRoleName = role.name;
                }
                if (guildCfg.memberRole && member.roles.cache.has(guildCfg.memberRole)) {
                    await member.roles.remove(guildCfg.memberRole).catch(() => null);
                }
            }
        } catch (err) {
            console.error('Role error:', err);
        }

        try {
            await removeWelcomeMessage(client, cfg, gid, guildCfg, interaction.user.id);
            await saveConfig(cfg);
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

        return interaction.editReply({ 
            content: buildVerificationReply(guildCfg, inClan, clan, clanRank, addedRoleName, interaction.user.id)
        });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_welcome_message_modal') {
        const message = interaction.fields.getTextInputValue('welcome_message').trim();
        cfg[gid].welcomeMessage = message;
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ content: `✅ Welcome message updated:\n${message.replace('{user}', '@[member]')}`, flags: 64 });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'setup_welcome_image_modal') {
        const url = interaction.fields.getTextInputValue('welcome_image_url').trim();
        if (url) {
            cfg[gid].welcomeImage = url;
        } else {
            delete cfg[gid].welcomeImage;
        }
        await saveConfig(cfg);
        await refreshSetupWizardPanel(interaction.guild, cfg, gid);
        return interaction.reply({ content: url ? '✅ Welcome image updated.' : '✅ Welcome image removed.', flags: 64 });
    }
});

client.on('guildMemberAdd', async member => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const cfg = await loadConfig();
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

    const welcomeText = guildCfg.welcomeMessage
        ? guildCfg.welcomeMessage.replace('{user}', `<@${member.id}>`)
        : `<@${member.id}> Click Link with RSN below to verify your RuneScape name and get your role.`;

    const messagePayload = { components: [row] };

    if (guildCfg.welcomeImage) {
        messagePayload.content = welcomeText;
        messagePayload.embeds = [{
            image: { url: guildCfg.welcomeImage }
        }];
    } else {
        messagePayload.content = welcomeText;
    }

    // if (guildCfg.welcomeImage) {
    //     messagePayload.content = `${welcomeText}\n${guildCfg.welcomeImage}`;
    // } else {
    //     messagePayload.content = welcomeText;
    // }
    
    // if (guildCfg.welcomeImage) {
    //     const embed = new EmbedBuilder()
    //         .setImage(guildCfg.welcomeImage)
    //         .setDescription(welcomeText);
    //     messagePayload.embeds = [embed];
    // } else {
    //     messagePayload.content = welcomeText;
    // }

    const msg = await ch.send(messagePayload);

    cfg[member.guild.id].welcomeMessages ??= {};
    cfg[member.guild.id].welcomeMessages[member.id] = {
        channelId: ch.id,
        messageId: msg.id
    };

    await saveConfig(cfg);
});

client.login(process.env.DISCORD_TOKEN).catch(err => console.error('Login failed:', err));