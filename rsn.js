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
        const normalize = str => str.toLowerCase().replace(/\u00a0/g, ' ').replace(/_/g, ' ').trim();

        const line = csv.split('\n').find(line => {
            const raw = line.split(',')[0] || '';
            const name = normalize(raw);
            if (raw.toLowerCase().includes('pop')) {
                console.log('Char codes:', [...raw].map(c => ({ char: c, code: c.charCodeAt(0) })));
            }
            return name === normalize(rsn);
        });

        if (!line) {
            console.log('No match found for RSN:', rsn);
            return null;
        }

        const parts = line.split(',');
        return {
            rank: (parts[1] || '').trim() || null
        };

    } catch (err) {
        console.error('clan check error:', err);
        return null;
    }
}

module.exports = {
    verifyRSN,
    getClanMemberInfo
};