require('dotenv').config();
const fs = require('fs');
const {Client,GatewayIntentBits,SlashCommandBuilder,PermissionFlagsBits,
ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle}
= require('discord.js');

const client = new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});

const loadConfig=()=>JSON.parse(fs.readFileSync('./config.json','utf8'));
const saveConfig=(d)=>fs.writeFileSync('./config.json',JSON.stringify(d,null,2));

async function verifyRSN(rsn){
 const r=await fetch(`https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(rsn)}`);
 return r.ok;
}

async function isClanMember(rsn, clanName){
 const r=await fetch(`https://secure.runescape.com/m=clan-hiscores/members_lite.ws?clanName=${encodeURIComponent(clanName)}`);
 if(!r.ok) return false;
 const csv=await r.text();
 return csv.split('\n').some(line=>{
   const name=(line.split(',')[0]||'').trim();
   return name.toLowerCase()===rsn.toLowerCase();
 });
}

client.once('ready', async()=>{
 const commands=[
  new SlashCommandBuilder().setName('setup-channel').setDescription('Set welcome channel')
   .addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true))
   .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setup-clan').setDescription('Set clan')
   .addStringOption(o=>o.setName('clan').setDescription('Clan').setRequired(true))
   .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('status').setDescription('Show config')
 ];
 await client.application.commands.set(commands.map(c=>c.toJSON()));
 console.log('Ready');
});

client.on('interactionCreate', async interaction=>{
 if(interaction.isChatInputCommand()){
   const cfg=loadConfig();
   const gid=interaction.guild.id;
   cfg[gid] ??= {};

   if(interaction.commandName==='setup-channel'){
      cfg[gid].welcomeChannel=interaction.options.getChannel('channel').id;
      saveConfig(cfg);
      return interaction.reply({content:'Welcome channel saved.',ephemeral:true});
   }

   if(interaction.commandName==='setup-clan'){
      cfg[gid].clan=interaction.options.getString('clan');
      saveConfig(cfg);
      return interaction.reply({content:`Clan set to ${cfg[gid].clan}`,ephemeral:true});
   }

   if(interaction.commandName==='status'){
      return interaction.reply({content:JSON.stringify(cfg[gid]||{},null,2),ephemeral:true});
   }
 }

 if(interaction.isButton() && interaction.customId==='add_rsn'){
   const modal=new ModalBuilder().setCustomId('rsn_modal').setTitle('Add RSN');
   const input=new TextInputBuilder().setCustomId('rsn').setLabel('Runescape Name').setStyle(TextInputStyle.Short);
   modal.addComponents(new ActionRowBuilder().addComponents(input));
   return interaction.showModal(modal);
 }

 if(interaction.isModalSubmit() && interaction.customId==='rsn_modal'){
   const rsn=interaction.fields.getTextInputValue('rsn');
   const cfg=loadConfig();
   const clan=cfg[interaction.guild.id]?.clan;

   if(!clan){
      return interaction.reply({content:'Clan not configured. Use /setup-clan',ephemeral:true});
   }

   await interaction.deferReply({ephemeral:true});

   if(!(await verifyRSN(rsn))){
      return interaction.editReply({content:`RSN not found: ${rsn}`});
   }

   if(!(await isClanMember(rsn, clan))){
      return interaction.editReply({content:`${rsn} is not in clan ${clan}`});
   }

   try{
      await interaction.member.setNickname(rsn);
      return interaction.editReply({content:`Verified! ${rsn} is in ${clan}.`});
   }catch{
      return interaction.editReply({content:`Verified, but nickname could not be changed.`});
   }
 }
});

client.on('guildMemberAdd', async member=>{
 const cfg=loadConfig()[member.guild.id];
 if(!cfg?.welcomeChannel) return;
 const ch=member.guild.channels.cache.get(cfg.welcomeChannel);
 if(!ch) return;

 const row=new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId('add_rsn').setLabel('Add RSN').setStyle(ButtonStyle.Primary)
 );

 ch.send({content:`Welcome ${member}! Click Add RSN below.`,components:[row]});
});

client.login(process.env.TOKEN);
