import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Events,
    ChannelType
} from 'discord.js';
import fetch from 'node-fetch';
import cron from 'node-cron';
import pool from './db.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const BOT_CHANNEL_ID = process.env.BOT_CHANNEL_ID;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const APP_TIMEZONE = 'America/Los_Angeles';

const REMINDER_POLL_CRON = '* * * * *';

// Track reminder DM loops in memory so we do not start duplicates
const activeReminderLoops = new Map();

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;


// Daily at 8:00 AM LA time
const DAILY_CRON = '0 8 * * *';

// Every hour at minute 0 LA time
const HOURLY_CHANCE_CRON = '0 * * * *';

// Every day at 6:07 PM LA time
const SIXTY_SEVEN_CRON = '7 18 * * *';

// Every day at 00:00 LA time
const BIRTHDAY_CHECK_CRON = '0 0 * * *';

// Hardcoded 67 ping target
const SIX_SEVEN_VICTIM = '1016444274625237042'; // AKA Shannyn
const DANIEL_USER_ID = "135491462849757185";

// Hourly chance system
const BASE_HOURLY_CHANCE = 2;
let currentHourlyChance = BASE_HOURLY_CHANCE; // starts the currently hourly chance at a base 5%

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

async function getRandomPlanePhoto() {
    if (!PEXELS_API_KEY) {
        throw new Error('PEXELS_API_KEY is missing from environment variables.');
    }

    const queries = ['plane', 'airplane', 'jet', 'aircraft'];
    const randomQuery = queries[Math.floor(Math.random() * queries.length)];
    const randomPage = Math.floor(Math.random() * 20) + 1;

    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(randomQuery)}&per_page=20&page=${randomPage}&orientation=landscape`;

    const response = await fetch(url, {
        headers: {
            Authorization: PEXELS_API_KEY
        }
    });

    if (!response.ok) {
        throw new Error(`Pexels API error: ${response.status}`);
    }

    const data = await response.json();

    const photos = data?.photos ?? [];

    if (photos.length === 0) {
        throw new Error('No plane photos returned from Pexels.');
    }

    const photo = photos[Math.floor(Math.random() * photos.length)];

    return {
        imageUrl: photo.src?.large2x || photo.src?.large || photo.src?.original,
        photographer: photo.photographer,
        pexelsUrl: photo.url
    };
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

function getLosAngelesNowParts() {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });

    const parts = formatter.formatToParts(now);

    const get = type => Number(parts.find(part => part.type === type)?.value);

    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second')
    };
}

function buildReminderDateString(year, month, day, hour, minute) {
    const yyyy = String(year);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const min = String(minute).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}:${min}:00`;
}

function isFutureReminder(month, day, hour, minute) {
    const now = getLosAngelesNowParts();

    const currentNumber =
        now.year * 100000000 +
        now.month * 1000000 +
        now.day * 10000 +
        now.hour * 100 +
        now.minute;

    const targetNumber =
        now.year * 100000000 +
        month * 1000000 +
        day * 10000 +
        hour * 100 +
        minute;

    return targetNumber > currentNumber;
}

async function startReminderLoop(reminder) {
    if (activeReminderLoops.has(reminder.id)) {
        return;
    }

    const user = await client.users.fetch(reminder.user_id);

    const interval = setInterval(async () => {
        try {
            await user.send(
                `⏰ Reminder: ${reminder.reminder_message}\n` +
                `Use /stopreminder in the bot channel to stop this reminder.`
            );
        } catch (err) {
            console.error(`Failed to send reminder DM for reminder ${reminder.id}:`, err);
        }
    }, 10000);

    activeReminderLoops.set(reminder.id, interval);

    // Send one immediately too
    try {
        await user.send(
            `⏰ Reminder: ${reminder.reminder_message}\n` +
            `Use /stopreminder in the bot channel to stop this reminder.`
        );
    } catch (err) {
        console.error(`Failed to send initial reminder DM for reminder ${reminder.id}:`, err);
    }
}

async function stopAllReminderLoopsForUser(userId) {
    const [rows] = await pool.query(
        `
        SELECT id
        FROM quote_bot_reminders
        WHERE user_id = ? AND is_active = 1
        `,
        [userId]
    );

    for (const row of rows) {
        const interval = activeReminderLoops.get(row.id);

        if (interval) {
            clearInterval(interval);
            activeReminderLoops.delete(row.id);
        }
    }

    if (rows.length > 0) {
        await pool.query(
            `
            DELETE FROM quote_bot_reminders
            WHERE user_id = ? AND is_active = 1
            `,
            [userId]
        );
    }

    return rows.length;
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

        // Reminder checker: every minute LA time
    cron.schedule(REMINDER_POLL_CRON, async () => {
        try {
            const now = getLosAngelesNowParts();
            const nowString = buildReminderDateString(
                now.year,
                now.month,
                now.day,
                now.hour,
                now.minute
            );

            const [rows] = await pool.query(
                `
                SELECT id, user_id, username, reminder_message, remind_at
                FROM quote_bot_reminders
                WHERE is_active = 1
                  AND has_triggered = 0
                  AND remind_at <= ?
                `,
                [nowString]
            );

            for (const row of rows) {
                await pool.query(
                `
                UPDATE quote_bot_reminders
                SET has_triggered = 1,
                    is_active = 1
                WHERE id = ?
                `,
                [row.id]
            );

                await startReminderLoop(row);
                console.log(`Started reminder loop for reminder ${row.id}.`);
            }
        } catch (err) {
            console.error('Failed reminder poll:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    // Every hour, chance starts at 2% and increases by 0.25% for each miss
    cron.schedule(HOURLY_CHANCE_CRON, async () => {
        try {
            const roll = Math.random() * 100;

            if (roll >= currentHourlyChance) {
                console.log(
                    `Hourly quote skipped. Roll: ${roll.toFixed(2)} | Chance was ${currentHourlyChance}%`
                );
                currentHourlyChance += 0.25; // increments odds by 0.25 for each miss until it is hit
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
                content: `@everyone Random hourly quote hit at ${currentHourlyChance}% odds:\n${formatQuote(row)}`,
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
                content: `<@${SIX_SEVEN_VICTIM}> 67`
            });

            console.log('Posted daily 67 message.');
        } catch (err) {
            console.error('Failed to post 67 message:', err);
        }
    }, {
        timezone: APP_TIMEZONE
    });

    // // ============================================================
    // // 67 DM SPAM (TEMPORARY)
    // // Sends 67 DMs for 1 minute at 6:07 PM
    // // TODO: COMMENT OUT THIS ENTIRE BLOCK WHEN DONE ANNOYING SHANNYN
    // // ============================================================
    // cron.schedule(SIXTY_SEVEN_CRON, async () => {
    //     try {
    //         const user = await client.users.fetch(SIX_SEVEN_VICTIM);

    //         console.log('Starting 67 DM spam');

    //         const totalMessages = 67;
    //         const totalDuration = 60000; // 60 seconds
    //         const startTime = Date.now();

    //         let count = 0;

    //         const sendNext = async () => {
    //             if (count >= totalMessages) {
    //                 console.log(`Total sent DMs: ${count}`);
    //                 console.log('Finished 67 DM spam.');
    //                 return;
    //             }

    //             try {
    //                 await user.send('67');
    //                 count++;
    //                 // console.log(`Sent DM #${count}`);
    //             } catch (err) {
    //                 console.error('Failed to send DM:', err);
    //             }
                

    //             // Calculate when the NEXT message should be sent
    //             const nextTargetTime = startTime + ((count + 1) * totalDuration / totalMessages);
    //             const delay = nextTargetTime - Date.now();

    //             setTimeout(sendNext, Math.max(0, delay));
    //         };

    //         // Start immediately
    //         sendNext();

    //     } catch (err) {
    //         console.error('Failed to start DM test:', err);
    //     }
    // }, {
    //     timezone: APP_TIMEZONE
    // });

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
                const user = await client.users.fetch(DANIEL_USER_ID);

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
            let count = 0;
            try {
                const user = interaction.user;

                await interaction.reply({
                    content: 'Prepare for pure brainrot',
                    ephemeral: true
                });

                console.log('Starting pure brainrot');

            const totalMessages = 67;
            const totalDuration = 60000; // 60 seconds
            const startTime = Date.now();

            

            const sendNext = async () => {
                if (count >= totalMessages) {
                    console.log('Finished pure brainrot spam.');
                    console.log(`Total sent DMs: ${count}`);
                    return;
                }

                try {
                    await user.send('67');
                    count++;
                    // console.log(`Sent DM #${count}`);
                } catch (err) {
                    console.error('Failed to send DM:', err);
                }

                // Calculate when the NEXT message should be sent
                const nextTargetTime = startTime + ((count + 1) * totalDuration / totalMessages);
                const delay = nextTargetTime - Date.now();

                setTimeout(sendNext, Math.max(0, delay));
            };

            // Start immediately
            sendNext();
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

        else if (commandName === 'setreminder') {
            const month = interaction.options.getInteger('month');
            const day = interaction.options.getInteger('day');
            const hour = interaction.options.getInteger('hour');
            const minute = interaction.options.getInteger('minute');
            const message = interaction.options.getString('message').trim();

            if (!isValidMonthDay(month, day)) {
                await interaction.reply({
                    content: 'That is not a valid month/day combination.',
                    ephemeral: true
                });
                return;
            }

            if (!isFutureReminder(month, day, hour, minute)) {
                await interaction.reply({
                    content: 'That reminder time must be later than the current LA time.',
                    ephemeral: true
                });
                return;
            }

            const now = getLosAngelesNowParts();
            const remindAt = buildReminderDateString(
                now.year,
                month,
                day,
                hour,
                minute
            );

            const [result] = await pool.query(
                `
                INSERT INTO quote_bot_reminders
                    (user_id, username, reminder_message, remind_at, is_active, has_triggered)
                VALUES (?, ?, ?, ?, 1, 0)
                `,
                [
                    interaction.user.id,
                    interaction.user.username,
                    message,
                    remindAt
                ]
            );

            await interaction.reply({
                content:
                    `✅ Reminder set.\n` +
                    `Time: **${month}/${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}** LA time\n` +
                    `Message: **${message}**\n\n` +
                    `When it triggers, I will DM you every 10 seconds until you use **/stopreminder**.`,
                ephemeral: true
            });
        }

        else if (commandName === 'stopreminder') {
            const stoppedCount = await stopAllReminderLoopsForUser(interaction.user.id);

            if (stoppedCount === 0) {
                await interaction.reply({
                    content: 'You do not have any active triggered reminders right now.',
                    ephemeral: true
                });
                return;
            }

            await interaction.reply({
                content: `✅ Stopped and deleted **${stoppedCount}** active reminder(s).`,
                ephemeral: true
            });
        }

        else if (commandName === 'makedanielhappy') {
            try {
                if (!DANIEL_USER_ID) {
                    throw new Error('DANIEL_USER_ID is missing from environment variables.');
                }

                const danielUser = await client.users.fetch(DANIEL_USER_ID);
                const senderMention = `<@${interaction.user.id}>`;

                const photo = await getRandomPlanePhoto();

                await danielUser.send({
                    content:
                         `✈️ A [plane](${photo.imageUrl}) has arrived from ${senderMention}!\n`
                });

                await interaction.reply({
                    content: '✅ Sent Daniel a plane pic.',
                    ephemeral: true
                });

            } catch (err) {
                console.error('makedanielhappy failed:', err);

                await interaction.reply({
                    content: '❌ Failed to send Daniel a plane pic. Check console.',
                    ephemeral: true
                });
            }
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