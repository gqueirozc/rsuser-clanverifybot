const { PermissionFlagsBits, ChannelType } = require('discord.js');

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

module.exports = {
    createTicketChannel,
    closeTicketChannel
};