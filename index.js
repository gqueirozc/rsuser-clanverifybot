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
    EmbedBuilder
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

const DEFAULT_SEARCHING_MESSAGE = '🔎 Searching RuneScape name...';
const DEFAULT_WELCOME_REPLY = 'Welcome to the server!';

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
    const guildCfg = getGuildConfig(cfg, gid);

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

        if (interaction.commandName === 'setup-server-logs') {
            cfg[gid].serverLogsChannel =
                interaction.options.getChannel('channel').id;

            saveConfig(cfg);

            return interaction.reply({
                content: 'Server logs channel set',
                ephemeral: true
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
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

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

        const guildCfg = cfg[gid];
        const messageId = interaction.message?.id;
        const welcomeEntries = guildCfg?.welcomeMessages || {};
        const targetEntry = Object.entries(welcomeEntries).find(([, value]) => value.messageId === messageId);

        if (targetEntry && targetEntry[0] !== interaction.user.id) {
            return interaction.reply({
                content: 'This button is only for the user it was posted for. If you need access, please use your own welcome prompt or ask an admin.',
                ephemeral: true
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

        const searchingMessage = guildCfg.searchingMessage || DEFAULT_SEARCHING_MESSAGE;
        await interaction.reply({
            content: searchingMessage,
            ephemeral: true
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
        content: 'Click Link with RSN below to verify your RuneScape name and get your role.',
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