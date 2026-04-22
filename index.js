import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
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
const APP_TIMEZONE = 'America/Los_Angeles';

// Daily at 8:00 AM LA time
const DAILY_CRON = '0 8 * * *';

// Every hour at minute 0 LA time
const HOURLY_CHANCE_CRON = '0 * * * *';

// Every day at 6:07 PM LA time
const SIXTY_SEVEN_CRON = '7 18 * * *';

// Every day at 00:00 LA time
const BIRTHDAY_CHECK_CRON = '0 0 * * *';

// Hardcoded 67 ping target
const SIX_SEVEN_TARGET = '1016444274625237042'; // AKA Shannyn

// Hourly chance system
const BASE_HOURLY_CHANCE = 5;
let currentHourlyChance = BASE_HOURLY_CHANCE;

// Track last displayed quote so random posts do not repeat back-to-back
let lastPostedQuoteId = null;

function formatQuote(row) {
    return `**${row.quoted_person}**:\n"${row.quote_text}"`;
}

// Keep IDs here so listquotes is useful for edit/delete
function formatQuoteInline(row) {
    return `#${row.id} - ${row.quoted_person}: "${row.quote_text}"`;
}

function isValidMonthDay(month, day) {
    const daysInMonth = {
        1: 31,
        2: 29,
        3: 31,
        4: 30,
        5: 31,
        6: 30,
        7: 31,
        8: 31,
        9: 30,
        10: 31,
        11: 30,
        12: 31
    };

    return day >= 1 && day <= (daysInMonth[month] ?? 0);
}

async function getRandomQuote(excludeId = null) {
    let sql = `
        SELECT id, quote_text, quoted_person
        FROM quote_bot_quotes
    `;
    const params = [];

    if (excludeId !== null) {
        sql += ` WHERE id != ?`;
        params.push(excludeId);
    }

    sql += `
        ORDER BY RAND()
        LIMIT 1
    `;

    const [rows] = await pool.query(sql, params);

    if (rows.length === 0 && excludeId !== null) {
        const [fallbackRows] = await pool.query(`
            SELECT id, quote_text, quoted_person
            FROM quote_bot_quotes
            ORDER BY RAND()
            LIMIT 1
        `);

        return fallbackRows[0] ?? null;
    }

    return rows[0] ?? null;
}

async function getRandomQuoteByPerson(person, excludeId = null) {
    let sql = `
        SELECT id, quote_text, quoted_person
        FROM quote_bot_quotes
        WHERE LOWER(quoted_person) = LOWER(?)
    `;
    const params = [person];

    if (excludeId !== null) {
        sql += ` AND id != ?`;
        params.push(excludeId);
    }

    sql += `
        ORDER BY RAND()
        LIMIT 1
    `;

    const [rows] = await pool.query(sql, params);

    if (rows.length === 0 && excludeId !== null) {
        const [fallbackRows] = await pool.query(`
            SELECT id, quote_text, quoted_person
            FROM quote_bot_quotes
            WHERE LOWER(quoted_person) = LOWER(?)
            ORDER BY RAND()
            LIMIT 1
        `, [person]);

        return fallbackRows[0] ?? null;
    }

    return rows[0] ?? null;
}

function rememberLastQuote(row) {
    if (row?.id != null) {
        lastPostedQuoteId = row.id;
    }
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

    // Daily 8 AM quote
    cron.schedule(DAILY_CRON, async () => {
        try {
            const generalChannel = await fetchGeneralChannel();
            const row = await getRandomQuote(lastPostedQuoteId);

            if (!row) {
                await generalChannel.send('No quotes found yet for the daily quote.');
                return;
            }

            await generalChannel.send({
                content: `☀️ **Daily Quote**\n${formatQuote(row)}`
            });

            rememberLastQuote(row);
            console.log('Daily quote posted successfully.');
        } catch (err) {
            console.error('Failed to post daily quote:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    // Every hour, chance starts at 5% and increases by 1% for each miss
    cron.schedule(HOURLY_CHANCE_CRON, async () => {
        try {
            const roll = Math.random() * 100;

            if (roll >= currentHourlyChance) {
                console.log(
                    `Hourly quote skipped. Roll: ${roll.toFixed(2)} | Chance was ${currentHourlyChance}%`
                );
                currentHourlyChance += 1;
                return;
            }

            const generalChannel = await fetchGeneralChannel();
            const row = await getRandomQuote(lastPostedQuoteId);

            if (!row) {
                console.log('No quotes found for hourly random chance post.');
                currentHourlyChance = BASE_HOURLY_CHANCE;
                return;
            }

            await generalChannel.send({
                content: `@everyone\n${formatQuote(row)}`,
                allowedMentions: { parse: ['everyone'] }
            });

            rememberLastQuote(row);

            console.log(
                `Hourly quote posted. Roll: ${roll.toFixed(2)} | Chance was ${currentHourlyChance}%`
            );

            currentHourlyChance = BASE_HOURLY_CHANCE;
        } catch (err) {
            console.error('Failed hourly random quote check:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    // ============================================================
    // 67 FEATURE
    // Comment out or remove this whole block if it gets too annoying
    // ============================================================
    cron.schedule(SIXTY_SEVEN_CRON, async () => {
        try {
            const generalChannel = await fetchGeneralChannel();

            await generalChannel.send({
                content: `<@${SIX_SEVEN_TARGET}> 67`
            });

            console.log('Posted daily 67 message.');
        } catch (err) {
            console.error('Failed to post 67 message:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    // ============================================================
    // 67 DM SPAM TEST (TEMPORARY)
    // Sends a DM every 5 seconds for 1 minute at 6:07 PM
    // COMMENT OUT THIS ENTIRE BLOCK WHEN DONE TESTING
    // ============================================================
    cron.schedule(SIXTY_SEVEN_CRON, async () => {
        try {
            const user = await client.users.fetch(SIX_SEVEN_TARGET);

            console.log('Starting 67 DM spam test...');

            let count = 0;

            const interval = setInterval(async () => {
                try {
                    await user.send('67');
                    count++;
                    console.log(`Sent DM #${count}`);
                } catch (err) {
                    console.error('Failed to send DM during spam:', err);
                }

                // Stop after 1 minute (30 messages at 2s interval)
                if (count >= 30) {
                    clearInterval(interval);
                    console.log('Stopped 67 DM spam test.');
                }
            }, 2000); // 2 seconds

        } catch (err) {
            console.error('Failed to start DM spam test:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    // Birthday checker: every day right at 00:00 LA time
    cron.schedule(BIRTHDAY_CHECK_CRON, async () => {
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: APP_TIMEZONE,
                month: 'numeric',
                day: 'numeric'
            });

            const parts = formatter.formatToParts(now);
            const month = Number(parts.find(part => part.type === 'month')?.value);
            const day = Number(parts.find(part => part.type === 'day')?.value);

            const [rows] = await pool.query(
                `
                SELECT birthday_user_id, birthday_username
                FROM quote_bot_birthdays
                WHERE month = ? AND day = ?
                `,
                [month, day]
            );

            if (rows.length === 0) {
                console.log(`No birthdays found for ${month}/${day}.`);
                return;
            }

            const generalChannel = await fetchGeneralChannel();
            const mentions = rows.map(row => `<@${row.birthday_user_id}>`).join(' ');

            await generalChannel.send({
                content: `🎉 Happy birthday ${mentions}!`
            });

            // TODO: Later, try sending each birthday user a DM too.
            // This can fail depending on privacy settings / DM availability.

            console.log(`Posted birthday message for ${month}/${day}.`);
        } catch (err) {
            console.error('Failed birthday check:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    console.log(`Daily quote scheduler started (${APP_TIMEZONE}).`);
    console.log(`Hourly 5% quote scheduler started (${APP_TIMEZONE}).`);
    console.log(`67 scheduler started (${APP_TIMEZONE}).`);
    console.log(`Birthday scheduler started (${APP_TIMEZONE}).`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (!(await requireBotChannel(interaction))) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'addquote') {
            const person = interaction.options.getString('person').trim();
            const quote = interaction.options.getString('quote').trim();

            const [duplicateRows] = await pool.query(
                `
                SELECT id, quote_text, quoted_person
                FROM quote_bot_quotes
                WHERE LOWER(TRIM(quoted_person)) = LOWER(TRIM(?))
                  AND LOWER(TRIM(quote_text)) = LOWER(TRIM(?))
                LIMIT 1
                `,
                [person, quote]
            );

            if (duplicateRows.length > 0) {
                const existing = duplicateRows[0];

                await interaction.reply({
                    content:
                        `That quote already exists as **#${existing.id}**.\n` +
                        `**${existing.quoted_person}**:\n"${existing.quote_text}"`,
                    ephemeral: true
                });
                return;
            }

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

        else if (commandName === 'addbirthday') {
            const targetUser = interaction.options.getUser('user');
            const month = interaction.options.getInteger('month');
            const day = interaction.options.getInteger('day');

            if (!isValidMonthDay(month, day)) {
                await interaction.reply({
                    content: 'That is not a valid month/day combination.',
                    ephemeral: true
                });
                return;
            }

            await pool.query(
                `
                INSERT INTO quote_bot_birthdays
                    (birthday_user_id, birthday_username, month, day, created_by_user_id, created_by_username)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    birthday_username = VALUES(birthday_username),
                    month = VALUES(month),
                    day = VALUES(day),
                    created_by_user_id = VALUES(created_by_user_id),
                    created_by_username = VALUES(created_by_username)
                `,
                [
                    targetUser.id,
                    targetUser.username,
                    month,
                    day,
                    interaction.user.id,
                    interaction.user.username
                ]
            );

            await interaction.reply({
                content:
                    `Saved birthday for <@${targetUser.id}> as **${month}/${day}**.`,
                ephemeral: true
            });
        }

        else if (commandName === 'randomquote') {
            const row = await getRandomQuote(lastPostedQuoteId);

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

            rememberLastQuote(row);

            await interaction.reply({
                content: `Posted a random quote in <#${GENERAL_CHANNEL_ID}>.`,
                ephemeral: true
            });
        }

        else if (commandName === 'quotesbyperson') {
            const person = interaction.options.getString('person');
            const row = await getRandomQuoteByPerson(person, lastPostedQuoteId);

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

            rememberLastQuote(row);

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
            const sqlParams = [];

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

        else if (commandName === 'stats') {
            const [[totalsRow]] = await pool.query(`
                SELECT
                    COUNT(*) AS total_quotes,
                    COUNT(DISTINCT quoted_person) AS total_people
                FROM quote_bot_quotes
            `);

            const [topQuotedRows] = await pool.query(`
                SELECT quoted_person, COUNT(*) AS quote_count
                FROM quote_bot_quotes
                GROUP BY quoted_person
                ORDER BY quote_count DESC, quoted_person ASC
                LIMIT 1
            `);

            const [topAdderRows] = await pool.query(`
                SELECT
                    added_by_username,
                    added_by_user_id,
                    COUNT(*) AS added_count
                FROM quote_bot_quotes
                GROUP BY added_by_user_id, added_by_username
                ORDER BY added_count DESC, added_by_username ASC
                LIMIT 1
            `);

            const topQuoted = topQuotedRows[0];
            const topAdder = topAdderRows[0];

            let message =
                `📊 **Quote Stats**\n` +
                `Total quotes: **${totalsRow.total_quotes}**\n` +
                `People quoted: **${totalsRow.total_people}**\n`;

            if (topQuoted) {
                message += `Most quoted person: **${topQuoted.quoted_person}** (${topQuoted.quote_count})\n`;
            }

            if (topAdder) {
                message += `Top quote adder: **${topAdder.added_by_username}** (${topAdder.added_count})\n`;
            }

            await interaction.reply({
                content: message,
                ephemeral: true
            });
        }

        else if (commandName === 'editquote') {
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

            await pool.query(
                `
                UPDATE quote_bot_quotes
                SET quote_text = ?, quoted_person = ?
                WHERE id = ?
                `,
                [updatedQuote, updatedPerson, id]
            );

            await interaction.reply({
                content:
                    `Quote **#${id}** updated.\n` +
                    `**${updatedPerson}**:\n"${updatedQuote}"`,
                ephemeral: true
            });
        }

        else if (commandName === 'deletequote') {
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

            if (lastPostedQuoteId === id) {
                lastPostedQuoteId = null;
            }

            await interaction.reply({
                content: `Deleted quote **#${id}**.`,
                ephemeral: true
            });
        }

        else if (commandName === 'annoydaniel') {
            try {
                const user = await client.users.fetch('593595572557053952');

                const senderMention = `<@${interaction.user.id}>`;

                await user.send(`Fuck you -from ${senderMention}`);

                await interaction.reply({
                    content: '✅ DM sent successfully.',
                    ephemeral: true
                });

            } catch (err) {
                console.error('DM failed:', err);

                await interaction.reply({
                    content: '❌ Failed to send DM. Check console.',
                    ephemeral: true
                });
            }
        }

        else if (commandName === 'purebrainrot') {
            try {
                const user = interaction.user;

                await interaction.reply({
                    content: 'Prepare for pure brainrot',
                    ephemeral: true
                });

                let count = 0;

                const interval = setInterval(async () => {
                    try {
                        await user.send('67');
                        count++;

                        if (count >= 60) {
                            clearInterval(interval);
                            console.log(`Stopped purebrainrot DM for ${user.id}.`);
                        }
                    } catch (err) {
                        console.error('Failed to send purebrainrot DM:', err);
                        clearInterval(interval);
                    }
                }, 1000);
            } catch (err) {
                console.error('purebrainrot command failed:', err);

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({
                        content: 'Failed to start DM spam.',
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: 'Failed to start DM spam.',
                        ephemeral: true
                    });
                }
            }
        }

        else if (commandName === 'everyonequote') {
            const row = await getRandomQuote(lastPostedQuoteId);

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

            rememberLastQuote(row);

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