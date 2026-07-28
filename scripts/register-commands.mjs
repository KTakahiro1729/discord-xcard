const required = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_BOT_TOKEN",
];

for (const name of required) {
  if (!process.env[name]) {
    console.error(`${name} is required`);
    process.exit(1);
  }
}

const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_BOT_TOKEN;

const response = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
  {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "xcard-setup",
      description: "このチャンネルに匿名Xカードを設置します",
      type: 1,
      dm_permission: false,
      default_member_permissions: "32"
    }),
  },
);

if (!response.ok) {
  console.error(`Command registration failed: ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const command = await response.json();
console.log(`Registered /${command.name} (${command.id})`);
