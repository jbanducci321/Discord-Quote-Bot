import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    Events,
    ChannelType
} from 'discord.js';
import cron from 'node-cron';
import pool from './db.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const BOT_CHANNEL_ID = process.env.BOT_CHANNEL_ID;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;

// Daily at 8:00 AM
const DAILY_CRON = '0 8 * * *';

function formatQuote(row) {
    return `**Quote #${row.id}**\n**${row.quoted_person}**:\n"${row.quote_text}"`;
}

function formatQuoteInline(row) {
    return `#${row.id} - ${row.quoted_person}: "${row.quote_text}"`;
}

async function getRandomQuote() {
    const sql = `
        SELECT id, quote_text, quoted_person
        FROM quote_bot_quotes
        ORDER BY RAND()
        LIMIT 1
    `;

    const [rows] = await pool.query(sql);
    return rows[0] ?? null;
}

async function getRandomQuoteByPerson(person) {
    const sql = `
        SELECT id, quote_text, quoted_person
        FROM quote_bot_quotes
        WHERE LOWER(quoted_person) = LOWER(?)
        ORDER BY RAND()
        LIMIT 1
    `;

    const [rows] = await pool.query(sql, [person]);
    return rows[0] ?? null;
}

async function fetchGeneralChannel() {
    const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);

    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error('GENERAL_CHANNEL_ID is invalid or not a text channel.');
    }

    return channel;
}

async function requireBotChannel(interaction) {
    if (interaction.channelId === BOT_CHANNEL_ID) {
        return true;
    }

    await interaction.reply({
        content: `Please use bot commands in <#${BOT_CHANNEL_ID}>.`,
        ephemeral: true
    });

    return false;
}

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const [rows] = await pool.query('SELECT 1 + 1 AS test');
        console.log('Database connected:', rows[0]);
    } catch (err) {
        console.error('Database connection failed:', err);
    }

    cron.schedule(DAILY_CRON, async () => {
        try {
            const generalChannel = await fetchGeneralChannel();
            const row = await getRandomQuote();

            if (!row) {
                await generalChannel.send('No quotes found yet for the daily quote.');
                return;
            }

            await generalChannel.send({
                content: `☀️ **Daily Quote**\n${formatQuote(row)}`
            });

            console.log('Daily quote posted successfully.');
        } catch (err) {
            console.error('Failed to post daily quote:', err);
        }
    });

    console.log('Daily quote scheduler started.');
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (!(await requireBotChannel(interaction))) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'addquote') {
            const person = interaction.options.getString('person');
            const quote = interaction.options.getString('quote');

            const sql = `
                INSERT INTO quote_bot_quotes
                (quote_text, quoted_person, added_by_user_id, added_by_username)
                VALUES (?, ?, ?, ?)
            `;

            const sqlParams = [
                quote,
                person,
                interaction.user.id,
                interaction.user.username
            ];

            const [result] = await pool.query(sql, sqlParams);

            await interaction.reply({
                content:
                    `Quote added with ID **${result.insertId}**.\n` +
                    `**${person}**:\n"${quote}"`,
                ephemeral: true
            });
        }

        else if (commandName === 'randomquote') {
            const row = await getRandomQuote();

            if (!row) {
                await interaction.reply({
                    content: 'No quotes found yet.',
                    ephemeral: true
                });
                return;
            }

            const generalChannel = await fetchGeneralChannel();

            await generalChannel.send({
                content: formatQuote(row)
            });

            await interaction.reply({
                content: `Posted a random quote in <#${GENERAL_CHANNEL_ID}>.`,
                ephemeral: true
            });
        }

        else if (commandName === 'quotesbyperson') {
            const person = interaction.options.getString('person');
            const row = await getRandomQuoteByPerson(person);

            if (!row) {
                await interaction.reply({
                    content: `No quotes found for **${person}**.`,
                    ephemeral: true
                });
                return;
            }

            const generalChannel = await fetchGeneralChannel();

            await generalChannel.send({
                content: formatQuote(row)
            });

            await interaction.reply({
                content: `Posted a quote from **${person}** in <#${GENERAL_CHANNEL_ID}>.`,
                ephemeral: true
            });
        }

        else if (commandName === 'listquotes') {
            const person = interaction.options.getString('person');

            let sql = `
                SELECT id, quote_text, quoted_person
                FROM quote_bot_quotes
            `;
            let sqlParams = [];

            if (person) {
                sql += ` WHERE LOWER(quoted_person) = LOWER(?)`;
                sqlParams.push(person);
            }

            sql += ` ORDER BY id DESC LIMIT 15`;

            const [rows] = await pool.query(sql, sqlParams);

            if (rows.length === 0) {
                await interaction.reply({
                    content: person
                        ? `No quotes found for **${person}**.`
                        : 'No quotes found yet.',
                    ephemeral: true
                });
                return;
            }

            const output = rows.map(formatQuoteInline).join('\n\n');

            await interaction.reply({
                content: output.length > 1900
                    ? output.slice(0, 1900) + '\n\n...'
                    : output,
                ephemeral: true
            });
        }

        else if (commandName === 'editquote') {
            if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
                await interaction.reply({
                    content: 'You do not have permission to edit quotes.',
                    ephemeral: true
                });
                return;
            }

            const id = interaction.options.getInteger('id');
            const newQuote = interaction.options.getString('quote');
            const newPerson = interaction.options.getString('person');

            const [existingRows] = await pool.query(
                'SELECT * FROM quote_bot_quotes WHERE id = ?',
                [id]
            );

            if (existingRows.length === 0) {
                await interaction.reply({
                    content: `Quote ID **${id}** was not found.`,
                    ephemeral: true
                });
                return;
            }

            const existing = existingRows[0];

            const updatedQuote = newQuote ?? existing.quote_text;
            const updatedPerson = newPerson ?? existing.quoted_person;

            const sql = `
                UPDATE quote_bot_quotes
                SET quote_text = ?, quoted_person = ?
                WHERE id = ?
            `;

            await pool.query(sql, [updatedQuote, updatedPerson, id]);

            await interaction.reply({
                content:
                    `Quote **#${id}** updated.\n` +
                    `**${updatedPerson}**:\n"${updatedQuote}"`,
                ephemeral: true
            });
        }

        else if (commandName === 'deletequote') {
            if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
                await interaction.reply({
                    content: 'You do not have permission to delete quotes.',
                    ephemeral: true
                });
                return;
            }

            const id = interaction.options.getInteger('id');

            const [rows] = await pool.query(
                'SELECT * FROM quote_bot_quotes WHERE id = ?',
                [id]
            );

            if (rows.length === 0) {
                await interaction.reply({
                    content: `Quote ID **${id}** was not found.`,
                    ephemeral: true
                });
                return;
            }

            await pool.query('DELETE FROM quote_bot_quotes WHERE id = ?', [id]);

            await interaction.reply({
                content: `Deleted quote **#${id}**.`,
                ephemeral: true
            });
        }

        else if (commandName === 'everyonequote') {
            if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
                await interaction.reply({
                    content: 'You do not have permission to use this command.',
                    ephemeral: true
                });
                return;
            }

            const row = await getRandomQuote();

            if (!row) {
                await interaction.reply({
                    content: 'No quotes found yet.',
                    ephemeral: true
                });
                return;
            }

            const generalChannel = await fetchGeneralChannel();

            await generalChannel.send({
                content: `@everyone\n${formatQuote(row)}`,
                allowedMentions: { parse: ['everyone'] }
            });

            await interaction.reply({
                content: `Posted an @everyone quote in <#${GENERAL_CHANNEL_ID}>.`,
                ephemeral: true
            });
        }
    } catch (err) {
        console.error(err);

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: 'Something went wrong while processing that command.',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: 'Something went wrong while processing that command.',
                ephemeral: true
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);