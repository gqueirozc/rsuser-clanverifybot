const getGuildRole = async (guild, roleId) => {
    if (!roleId) return null;
    return guild.roles.cache.get(roleId) ||
        await guild.roles.fetch(roleId).catch(() => null);
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
    resolveChannel,
    resolveRole,
    applyMemberRoles,
    removeWelcomeMessage
};
 