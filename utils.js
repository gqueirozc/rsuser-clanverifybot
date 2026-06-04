const getGuildRole = async (guild, roleId) => {
    if (!roleId) return null;
    return guild.roles.cache.get(roleId) ||
        await guild.roles.fetch(roleId).catch(() => null);
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
    const matches = [...input.matchAll(/(\d+)/g)];
    for (const match of matches) {
        ids.add(match[1]);
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

const removeWelcomeMessage = async (client, cfg, gid, guildCfg, memberId) => {
    const welcome = guildCfg?.welcomeMessages?.[memberId];
    if (!welcome) return;

    try {
        const msgChannel = await client.channels.fetch(welcome.channelId).catch(() => null);
        const msg = msgChannel ? await msgChannel.messages.fetch(welcome.messageId).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => null);
    } catch (err) {
        console.error('Delete welcome error:', err);
    }

    delete guildCfg.welcomeMessages?.[memberId];
};

module.exports = {
    getGuildRole,
    normalizeTicketName,
    normalizeTicketTypeId,
    chunkArray,
    parseRoleIds,
    parseChannelIds,
    resolveChannel,
    resolveRole,
    applyMemberRoles,
    removeWelcomeMessage
};