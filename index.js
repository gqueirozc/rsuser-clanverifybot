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

function loadConfig() {
    try {
        return JSON.parse(
            fs.readFileSync('./config.json', 'utf8')
        );
    } catch {
        return {};
    }
}

function saveConfig(data) {
    fs.writeFileSync(
        './config.json',
        JSON.stringify(data, null, 2)
    );
}

async function verifyRSN(rsn) {
    try {
        const response = await fetch(
            `https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(rsn)}`
        );

        return response.ok;
    } catch (err) {
        console.error('RSN verification error:', err);
        return false;
    }
}

async function isClanMember(rsn, clanName) {
    try {
        const response = await fetch(
            `https://secure.runescape.com/m=clan-hiscores/members_lite.ws?clanName=${encodeURIComponent(clanName)}`
        );

        if (!response.ok) {
            return false;
        }

        const csv = await response.text();

        return csv
            .split('\n')
            .some(line => {
                const name =
                    (line.split(',')[0] || '')
                        .trim();

                return (
                    name.toLowerCase() ===
                    rsn.toLowerCase()
                );
            });

    } catch (err) {
        console.error(
            'Clan lookup error:',
            err
        );

        return false;
    }
}

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('setup-channel')
            .setDescription(
                'Set welcome channel'
            )
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription(
                        'Welcome channel'
                    )
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.Administrator
            ),

        new SlashCommandBuilder()
            .setName('setup-clan')
            .setDescription(
                'Set clan name'
            )
            .addStringOption(option =>
                option
                    .setName('clan')
                    .setDescription(
                        'Clan name'
                    )
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.Administrator
            ),

        new SlashCommandBuilder()
            .setName('setup-member-role')
            .setDescription(
                'Role given to clan members'
            )
            .addRoleOption(option =>
                option
                    .setName('role')
                    .setDescription('Role')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.Administrator
            ),

        new SlashCommandBuilder()
            .setName('setup-guest-role')
            .setDescription(
                'Role given to non-clan members'
            )
            .addRoleOption(option =>
                option
                    .setName('role')
                    .setDescription('Role')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(
                PermissionFlagsBits.Administrator
            ),

        new SlashCommandBuilder()
            .setName('status')
            .setDescription(
                'Show bot configuration'
            )
    ];

    await client.application.commands.set(
        commands.map(cmd => cmd.toJSON())
    );

    console.log(
        `Logged in as ${client.user.tag}`
    );
});

client.on(
    'interactionCreate',
    async interaction => {

        if (interaction.isChatInputCommand()) {

            const cfg = loadConfig();

            const guildId =
                interaction.guild.id;

            cfg[guildId] ??= {};

            if (
                interaction.commandName ===
                'setup-channel'
            ) {

                cfg[guildId].welcomeChannel =
                    interaction.options
                        .getChannel('channel')
                        .id;

                saveConfig(cfg);

                return interaction.reply({
                    content:
                        'Welcome channel saved.',
                    ephemeral: true
                });
            }

            if (
                interaction.commandName ===
                'setup-clan'
            ) {

                cfg[guildId].clan =
                    interaction.options.getString(
                        'clan'
                    );

                saveConfig(cfg);

                return interaction.reply({
                    content:
                        `Clan set to ${cfg[guildId].clan}`,
                    ephemeral: true
                });
            }

            if (
                interaction.commandName ===
                'setup-member-role'
            ) {

                cfg[guildId].memberRole =
                    interaction.options
                        .getRole('role')
                        .id;

                saveConfig(cfg);

                return interaction.reply({
                    content:
                        'Member role saved.',
                    ephemeral: true
                });
            }

            if (
                interaction.commandName ===
                'setup-guest-role'
            ) {

                cfg[guildId].guestRole =
                    interaction.options
                        .getRole('role')
                        .id;

                saveConfig(cfg);

                return interaction.reply({
                    content:
                        'Guest role saved.',
                    ephemeral: true
                });
            }

            if (
                interaction.commandName ===
                'status'
            ) {

                return interaction.reply({
                    content: '```json\n' +
                        JSON.stringify(
                            cfg[guildId] || {},
                            null,
                            2
                        ) +
                        '\n```',
                    ephemeral: true
                });
            }
        }

        if (
            interaction.isButton() &&
            interaction.customId ===
                'add_rsn'
        ) {

            const modal =
                new ModalBuilder()
                    .setCustomId(
                        'rsn_modal'
                    )
                    .setTitle(
                        'Add RSN'
                    );

            const input =
                new TextInputBuilder()
                    .setCustomId('rsn')
                    .setLabel(
                        'Runescape Name'
                    )
                    .setStyle(
                        TextInputStyle.Short
                    )
                    .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder()
                    .addComponents(input)
            );

            return interaction.showModal(
                modal
            );
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId ===
                'rsn_modal'
        ) {

            const rsn =
                interaction.fields
                    .getTextInputValue(
                        'rsn'
                    );

            const cfg = loadConfig();

            const guildCfg =
                cfg[
                    interaction.guild.id
                ];

            if (!guildCfg?.clan) {

                return interaction.reply({
                    content:
                        'Clan not configured. Use /setup-clan',
                    ephemeral: true
                });
            }

            await interaction.deferReply({
                ephemeral: true
            });

            const exists =
                await verifyRSN(rsn);

            if (!exists) {

                return interaction.editReply({
                    content:
                        `❌ RSN not found: ${rsn}`
                });
            }

            const clanMember =
                await isClanMember(
                    rsn,
                    guildCfg.clan
                );

            try {

                const member =
                    await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                await member.setNickname(
                    rsn
                );

            } catch (err) {

                console.error(
                    'Nickname change failed:',
                    err
                );
            }

            try {

                const member =
                    await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                if (
                    clanMember &&
                    guildCfg.memberRole
                ) {

                    await member.roles.add(
                        guildCfg.memberRole
                    );
                }

                if (
                    !clanMember &&
                    guildCfg.guestRole
                ) {

                    await member.roles.add(
                        guildCfg.guestRole
                    );
                }

            } catch (err) {

                console.error(
                    'Role assignment failed:',
                    err
                );
            }

            try {

                const welcome =
                    cfg.welcomeMessages?.[
                        interaction.user.id
                    ];

                if (welcome) {

                    const channel =
                        await interaction.guild.channels.fetch(
                            welcome.channelId
                        );

                    const message =
                        await channel.messages.fetch(
                            welcome.messageId
                        );

                    await message.delete();

                    delete cfg
                        .welcomeMessages[
                            interaction.user.id
                        ];

                    saveConfig(cfg);
                }

            } catch (err) {

                console.error(
                    'Welcome deletion failed:',
                    err
                );
            }

            return interaction.editReply({

                content: clanMember
                    ? `✅ Verified. ${rsn} is in ${guildCfg.clan}.`
                    : `✅ Verified. ${rsn} exists but is not in ${guildCfg.clan}.`
            });
        }
    }
);

client.on(
    'guildMemberAdd',
    async member => {

        const cfg = loadConfig();

        const guildCfg =
            cfg[member.guild.id];

        if (
            !guildCfg?.welcomeChannel
        ) {
            return;
        }

        const channel =
            member.guild.channels.cache.get(
                guildCfg.welcomeChannel
            );

        if (!channel) {
            return;
        }

        const row =
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            'add_rsn'
                        )
                        .setLabel(
                            'Add RSN'
                        )
                        .setStyle(
                            ButtonStyle.Primary
                        )
                );

        const message =
            await channel.send({
                content:
                    `Welcome ${member}! Click Add RSN below.`,
                components: [row]
            });

        cfg.welcomeMessages ??= {};

        cfg.welcomeMessages[
            member.id
        ] = {
            guildId:
                member.guild.id,
            channelId:
                channel.id,
            messageId:
                message.id
        };

        saveConfig(cfg);
    }
);

client.login(process.env.TOKEN);