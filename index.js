import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Events,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} from 'discord.js';
import fetch from 'node-fetch';
import cron from 'node-cron';
import pool from './db.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const BOT_CHANNEL_ID = process.env.BOT_CHANNEL_ID;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const APP_TIMEZONE = 'America/Los_Angeles';

const REMINDER_POLL_CRON = '* * * * *';

// Track reminder DM loops in memory so we do not start duplicates
const activeReminderLoops = new Map();

// Track in-progress solo blackjack games in memory, keyed by user ID
const activeBlackjackGames = new Map();

// Toggled in memory by /myfriendneil; resets to true on every bot restart
let neilPingsEnabled = true;

// Blackjack hit draws are rigged against this one user only — everyone else plays fair odds
const RIG_BUST_CHANCE = 0.8;

// Chance (0-1) that the daily word is a Shannafied word instead of the real Wordnik word of the day
const SHANWORD_CHANCE = 0.5;


// Daily at 8:00 AM LA time
const DAILY_CRON = '0 8 * * *';

// Every hour at minute 0 LA time
const HOURLY_CHANCE_CRON = '0 * * * *';

// Every day at 6:07 PM LA time
const SIXTY_SEVEN_CRON = '7 18 * * *';

// Every day at 00:00 LA time
const BIRTHDAY_CHECK_CRON = '0 0 * * *';

// Hardcoded 67 ping target
const SIX_SEVEN_VICTIM = process.env.SHANNYN_DISCORD_ID; // AKA Shannyn
const MAY_FIRST_OVERRIDE_QUOTE_ID = 16; // Shannyn's favorite quote

const DANIEL_USER_ID = process.env.DANIEL_DISCORD_ID;

const MY_FRIEND_NEIL = process.env.NEIL_DISCORD_ID;

//Every Tuesday, Thursday at 3:30 PM LA time
const NEIL_LOGIC_CRON = '30 15 * * 2,4'

//Every Tuesday, Thursday at 1:30 PM LA time
const NEIL_DATA_SCIENCE_CRON = '30 13 * * 2,4'

//Every Wednesday, Friday at 11:30 AM LA time
const NEIL_CAPSTONE_CRON = '30 11 * * 3,5'

//Every Friday at 9:30 AM LA time (this is the important one, apparently)
const NEIL_SERVICE_LEARNING_CRON = '30 9 * * 5'

// Same classes as above, but firing 10 minutes before instead of 30 — used for the general channel ping
//Every Tuesday, Thursday at 3:50 PM LA time
const NEIL_LOGIC_PING_CRON = '50 15 * * 2,4'

//Every Tuesday, Thursday at 1:50 PM LA time
const NEIL_DATA_SCIENCE_PING_CRON = '50 13 * * 2,4'

//Every Wednesday, Friday at 11:50 AM LA time
const NEIL_CAPSTONE_PING_CRON = '50 11 * * 3,5'

//Every Friday at 9:50 AM LA time
const NEIL_SERVICE_LEARNING_PING_CRON = '50 9 * * 5'

// Hourly chance system
const BASE_HOURLY_CHANCE = 1;
let currentHourlyChance = BASE_HOURLY_CHANCE; // starts the currently hourly chance at a base 5%

// Track last displayed quote so random posts do not repeat back-to-back
let lastPostedQuoteId = null;

async function getDailyWord() {
    if (!process.env.WORDNIK_API_KEY) {
        throw new Error('WORDNIK_API_KEY missing');
    }

    const res = await fetch('https://api.wordnik.com/v4/words.json/wordOfTheDay', {
        headers: {
            api_key: process.env.WORDNIK_API_KEY
        }
    });

    if (!res.ok) {
        throw new Error(`Wordnik error: ${res.status}`);
    }

    const data = await res.json();

    const defObj = data.definitions?.[0];

    return {
        word: data.word,
        definition: defObj?.text || 'No definition found.',
        partOfSpeech: defObj?.partOfSpeech || 'unknown'
    };
}

function formatQuote(row) {
    return `**${row.quoted_person}**:\n"${row.quote_text}"`;
}

// Keep IDs here so listquotes is useful for edit/delete
function formatQuoteInline(row) {
    return `#${row.id} - ${row.quoted_person}: "${row.quote_text}"`;
}

async function getRandomJoke(category = 'Any') {
    const url =
        `https://v2.jokeapi.dev/joke/${category}`;
  // +
  //       `?safe-mode&blacklistFlags=nsfw,religious,political,racist,sexist,explicit`;

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`JokeAPI error: ${res.status}`);
    }

    const data = await res.json();

    if (data.error) {
        throw new Error(data.message || 'JokeAPI returned an error.');
    }

    if (data.type === 'single') {
        return data.joke;
    }

    if (data.type === 'twopart') {
        return `${data.setup}\n${data.delivery}`;
    }

    return 'No joke found.';
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

async function getQuoteById(id) {
    const [rows] = await pool.query(
        `
        SELECT id, quote_text, quoted_person
        FROM quote_bot_quotes
        WHERE id = ?
        LIMIT 1
        `,
        [id]
    );

    return rows[0] ?? null;
}

// Sets all quotes to not used to restart daily quote cycle
async function resetDailyQuoteCycle() {
    await pool.query(`
        UPDATE quote_bot_quotes
        SET used_in_daily_cycle = 0
    `);
}

// Gets the quote for the daily quote, makes sure it hasn't been used in the current cycle
async function getNextDailyCycleQuote() {
    let [rows] = await pool.query(`
        SELECT id, quote_text, quoted_person
        FROM quote_bot_quotes
        WHERE used_in_daily_cycle = 0
        ORDER BY RAND()
        LIMIT 1
    `);

    if (rows.length === 0) { // If no more quotes are availible, restarts the cycle and tries again
        await resetDailyQuoteCycle();

        [rows] = await pool.query(`
            SELECT id, quote_text, quoted_person
            FROM quote_bot_quotes
            WHERE used_in_daily_cycle = 0
            ORDER BY RAND()
            LIMIT 1
        `);
    }

    return rows[0] ?? null;
}

// After a quote has been used its boolean value is changed to true
async function markQuoteUsedInDailyCycle(id) {
    await pool.query(
        `
        UPDATE quote_bot_quotes
        SET used_in_daily_cycle = 1
        WHERE id = ?
        `,
        [id]
    );
}

// Sets all Shanwords to not used to restart their cycle
async function resetShanwordCycle() {
    await pool.query(`
        UPDATE quote_bot_shanwords
        SET used_in_daily_cycle = 0
    `);
}

// Gets a Shanword for the daily word, makes sure it hasn't been used in the current cycle
async function getNextCycleShanword() {
    let [rows] = await pool.query(`
        SELECT id, word, definition
        FROM quote_bot_shanwords
        WHERE used_in_daily_cycle = 0
        ORDER BY RAND()
        LIMIT 1
    `);

    if (rows.length === 0) { // If no more Shanwords are available, restarts the cycle and tries again
        await resetShanwordCycle();

        [rows] = await pool.query(`
            SELECT id, word, definition
            FROM quote_bot_shanwords
            WHERE used_in_daily_cycle = 0
            ORDER BY RAND()
            LIMIT 1
        `);
    }

    return rows[0] ?? null;
}

// After a Shanword has been used its boolean value is changed to true
async function markShanwordUsedInCycle(id) {
    await pool.query(
        `
        UPDATE quote_bot_shanwords
        SET used_in_daily_cycle = 1
        WHERE id = ?
        `,
        [id]
    );
}

async function getShanwordById(id) {
    const [rows] = await pool.query(
        `
        SELECT id, word, definition
        FROM quote_bot_shanwords
        WHERE id = ?
        LIMIT 1
        `,
        [id]
    );

    return rows[0] ?? null;
}

// For a 'special' birthday surprise
function isMayFirstInLosAngeles() {
    const now = getLosAngelesNowParts();
    return now.month === 5 && now.day === 1;
}

// One-time bypass: 9/6/2026 only, not a recurring yearly date like isMayFirstInLosAngeles
function isShantagonizeBypassDayInLosAngeles() {
    const now = getLosAngelesNowParts();
    return now.year === 2026 && now.month === 9 && now.day === 6;
}

// =========================
// BLACKJACK
// =========================

const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CARD_SUITS = ['♠', '♥', '♦', '♣'];

function buildShuffledDeck() {
    const deck = [];

    for (const suit of CARD_SUITS) {
        for (const rank of CARD_RANKS) {
            deck.push({ rank, suit });
        }
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
}

function cardValue(card) {
    if (card.rank === 'A') return 11;
    if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
    return Number(card.rank);
}

function handValue(cards) {
    let total = cards.reduce((sum, card) => sum + cardValue(card), 0);
    let aces = cards.filter(card => card.rank === 'A').length;

    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }

    return total;
}

function formatCard(card) {
    return `${card.rank}${card.suit}`;
}

function formatHand(cards, { hideFirst = false } = {}) {
    return cards
        .map((card, i) => (hideFirst && i === 0) ? '🂠' : formatCard(card))
        .join('  ');
}

// Dealer draws are always fair. Only a hit for the rigged user can pull from here.
function drawFairCard(deck) {
    return deck.pop();
}

// The one rigged spot in the whole game: when the rigged user hits at 12+, heavily
// favor a card that busts them instead of dealing straight off the top of the deck.
function drawCardForHit(deck, currentHand, isRigged) {
    const currentTotal = handValue(currentHand);

    if (isRigged && currentTotal >= 12 && Math.random() < RIG_BUST_CHANCE) {
        const bustIndex = deck.findIndex(card => handValue([...currentHand, card]) > 21);

        if (bustIndex !== -1) {
            return deck.splice(bustIndex, 1)[0];
        }
    }

    return drawFairCard(deck);
}

function renderBlackjackTable(game, { revealDealer }) {
    const dealerTotal = revealDealer ? `${handValue(game.dealerHand)}` : '?';
    const playerTotal = handValue(game.playerHand);

    return (
        `**Dealer**: ${formatHand(game.dealerHand, { hideFirst: !revealDealer })}  (${dealerTotal})\n` +
        `**You**: ${formatHand(game.playerHand)}  (${playerTotal})`
    );
}

function buildBlackjackButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary)
    );
}

function resolveBlackjackOutcome(playerHand, dealerHand) {
    const playerTotal = handValue(playerHand);
    const dealerTotal = handValue(dealerHand);

    const playerBlackjack = playerTotal === 21 && playerHand.length === 2;
    const dealerBlackjack = dealerTotal === 21 && dealerHand.length === 2;

    if (dealerTotal > 21) return { message: '🎉 **Dealer busts! You win.**', result: 'win' };
    if (playerBlackjack && dealerBlackjack) return { message: "🤝 **Both blackjack — push.**", result: 'push' };
    if (playerBlackjack) return { message: '🎉 **Blackjack! You win.**', result: 'win' };
    if (dealerBlackjack) return { message: '😬 **Dealer has blackjack. You lose.**', result: 'lose' };
    if (playerTotal > dealerTotal) return { message: '🎉 **You win!**', result: 'win' };
    if (playerTotal < dealerTotal) return { message: '😬 **You lose.**', result: 'lose' };
    return { message: "🤝 **Push — it's a tie.**", result: 'push' };
}

// DM only fires for the one user the game is rigged against, and only on a loss
async function getInsult(who) {
    const res = await fetch(`https://insult.mattbas.org/api/en/insult.json?who=${encodeURIComponent(who)}`);

    if (!res.ok) {
        throw new Error(`Insult API error: ${res.status}`);
    }

    const data = await res.json();
    return data.insult;
}

async function sendBlackjackLossTaunt(user) {
    let taunt;

    try {
        taunt = await getInsult('Daniel');
    } catch (err) {
        console.error('Failed to fetch insult, falling back to default taunt:', err);
        taunt = 'You lost. You suck.';
    }

    try {
        await user.send(taunt);
    } catch (err) {
        console.error('Failed to send blackjack loss DM:', err);
    }
}

async function sendNeilReminder(message, cronName) {

    try {
        if (!MY_FRIEND_NEIL) {
            throw new Error('MY_FRIEND_NEIL is missing from environment variables');
        }

        const neilUser = await client.users.fetch(MY_FRIEND_NEIL);

        await neilUser.send({
            content: message
        })
    } catch (err) {
        console.error(`${cronName} failed:`, err);
    }

}

async function pingNeilInGeneral(message, cronName) {
    try {
        if (!MY_FRIEND_NEIL) {
            throw new Error('MY_FRIEND_NEIL is missing from environment variables');
        }

        if (!neilPingsEnabled) {
            return;
        }

        const generalChannel = await fetchGeneralChannel();

        await generalChannel.send({
            content: `<@${MY_FRIEND_NEIL}> ${message}`
        })
    } catch (err) {
        console.error(`${cronName} failed:`, err);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const [rows] = await pool.query('SELECT 1 + 1 AS test');
        console.log('Database connected:', rows[0]);
    } catch (err) {
        console.error('Database connection failed:', err);
    }

    // Daily 8 AM quote + word
    cron.schedule(DAILY_CRON, async () => {
        try {
            const generalChannel = await fetchGeneralChannel();

            // =========================
            // DAILY WORD
            // =========================
            let dailyWordText = '';

            // 9/6/2026 one-time bypass: force Shantagonize (#12), no cycle effect, same as the May 1 quote override
            if (isShantagonizeBypassDayInLosAngeles()) {
                const shantagonize = await getShanwordById(12);

                dailyWordText = shantagonize
                    ? `📚 **Daily Word**\n` +
                      `**${shantagonize.word}**\n` +
                      `${shantagonize.definition}\n\n`
                    : `📚 **Daily Word**\n` +
                      `Daily word unavailable today.\n\n`;
            } else if (Math.random() < SHANWORD_CHANCE) {
                try {
                    const shanword = await getNextCycleShanword();

                    if (!shanword) {
                        throw new Error('No Shanwords found in quote_bot_shanwords.');
                    }

                    dailyWordText =
                        `📚 **Daily Word**\n` +
                        `**${shanword.word}**\n` +
                        `${shanword.definition}\n\n`;

                    await markShanwordUsedInCycle(shanword.id);
                } catch (err) {
                    console.error('Failed to fetch Shanword:', err);

                    dailyWordText =
                        `📚 **Daily Word**\n` +
                        `Daily word unavailable today.\n\n`;
                }
            } else {
                try {
                    const wordEntry = await getDailyWord();

                    dailyWordText =
                        `📚 **Daily Word**\n` +
                        `**${wordEntry.word}** *(${wordEntry.partOfSpeech})*\n` +
                        `${wordEntry.definition}\n\n`;
                } catch (err) {
                    console.error('Failed to fetch daily word:', err);

                    dailyWordText =
                        `📚 **Daily Word**\n` +
                        `Daily word unavailable today.\n\n`;
                }
            }

            // May 1 override: post quote #16 and do NOT affect cycle state
            if (isMayFirstInLosAngeles()) {
                const overrideRow = await getQuoteById(MAY_FIRST_OVERRIDE_QUOTE_ID);

                if (!overrideRow) {
                    await generalChannel.send(
                        dailyWordText +
                        `Daily quote override failed: quote #${MAY_FIRST_OVERRIDE_QUOTE_ID} was not found.`
                    );
                    return;
                }

                await generalChannel.send({
                    content:
                        dailyWordText +
                        `☀️ **Daily Quote**\n${formatQuote(overrideRow)}`
                });

                rememberLastQuote(overrideRow);
                console.log(`Daily quote override posted for May 1 using quote #${MAY_FIRST_OVERRIDE_QUOTE_ID}.`);
                return;
            }

            const row = await getNextDailyCycleQuote();

            if (!row) {
                await generalChannel.send(
                    dailyWordText +
                    'No quotes found yet for the daily quote.'
                );
                return;
            }

            await generalChannel.send({
                content:
                    dailyWordText +
                    `☀️ **Daily Quote**\n${formatQuote(row)}`
            });

            await markQuoteUsedInDailyCycle(row.id);
            rememberLastQuote(row);

            console.log(`Daily word and quote posted successfully. Marked quote #${row.id} as used.`);
        } catch (err) {
            console.error('Failed to post daily word/quote:', err);
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

    // // Code for the random hourly quote logic
    // cron.schedule(HOURLY_CHANCE_CRON, async () => {
    //     try {
    //         const roll = Math.random() * 100;

    //         if (roll >= currentHourlyChance) {
    //             console.log(
    //                 `Hourly quote skipped. Roll: ${roll.toFixed(2)} | Chance was ${currentHourlyChance}%`
    //             );
    //             currentHourlyChance += 0.25; // increments odds by 0.25 for each miss until it is hit
    //             return;
    //         }

    //         const generalChannel = await fetchGeneralChannel();
    //         const row = await getRandomQuote(lastPostedQuoteId);

    //         if (!row) {
    //             console.log('No quotes found for hourly random chance post.');
    //             currentHourlyChance = BASE_HOURLY_CHANCE;
    //             return;
    //         }

    //         await generalChannel.send({
    //             content: `@everyone Random hourly quote hit at ${currentHourlyChance}% odds:\n${formatQuote(row)}`,
    //             allowedMentions: { parse: ['everyone'] }
    //         });

    //         rememberLastQuote(row);

    //         console.log(
    //             `Hourly quote posted. Roll: ${roll.toFixed(2)} | Chance was ${currentHourlyChance}%`
    //         );

    //         currentHourlyChance = BASE_HOURLY_CHANCE;
    //     } catch (err) {
    //         console.error('Failed hourly random quote check:', err);
    //     }
    // }, {
    //     timezone: APP_TIMEZONE
    // });

    // // ============================================================
    // // 67 FEATURE
    // // Comment out or remove this whole block if it gets too annoying
    // // ============================================================
    // cron.schedule(SIXTY_SEVEN_CRON, async () => {
    //     try {
    //         const generalChannel = await fetchGeneralChannel();

    //         await generalChannel.send({
    //             content: `<@${SIX_SEVEN_VICTIM}> 67`
    //         });

    //         console.log('Posted daily 67 message.');
    //     } catch (err) {
    //         console.error('Failed to post 67 message:', err);
    //     }
    // }, {
    //     timezone: APP_TIMEZONE
    // });

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

    // Disabled: Neil's class reminder DMs. Server pings below (toggleable via
    // /myfriendneil) replace these.
    // cron.schedule(NEIL_LOGIC_CRON, async () => sendNeilReminder(
    //     `Hello, I am QuoteBot, your AI assistant. This is a reminder that you have CST329 - Reasoning with Logic in 30 minutes, at 4:00 PM in BIT222.\n`
    // ), {
    //     timezone: APP_TIMEZONE
    // });

    // cron.schedule(NEIL_DATA_SCIENCE_CRON, async () => sendNeilReminder(
    //     `Hello, I am QuoteBot, your AI assistant. This is a reminder that you have CST383 - Introduction to Data Science in 30 minutes, at 2:00 PM in BIT110.\n`
    // ), {
    //     timezone: APP_TIMEZONE
    // });

    // cron.schedule(NEIL_CAPSTONE_CRON, async () => sendNeilReminder(
    //     `Hello, I am QuoteBot, your AI assistant. This is a reminder that you have CST499 - Computer Science Capstone in 30 minutes, at 12:00 PM in BIT110.\n`
    // ), {
    //     timezone: APP_TIMEZONE
    // });

    // cron.schedule(NEIL_SERVICE_LEARNING_CRON, async () => sendNeilReminder(
    //     `Hello, I am QuoteBot, your AI assistant. This is a reminder that you have CST462S - Race, Gender, Class in the Digital World in 30 minutes, at 10:00 AM in BIT224.\n`
    // ), {
    //     timezone: APP_TIMEZONE
    // });

    // General channel pings, 10 minutes before each class
    cron.schedule(NEIL_LOGIC_PING_CRON, () => pingNeilInGeneral(
        'you have CST329 - Reasoning with Logic in 10 minutes, at 4:00 PM in BIT222!',
        'NEIL_LOGIC_PING_CRON'
    ), {
        timezone: APP_TIMEZONE
    });

    cron.schedule(NEIL_DATA_SCIENCE_PING_CRON, () => pingNeilInGeneral(
        'you have CST383 - Introduction to Data Science in 10 minutes, at 2:00 PM in BIT110!',
        'NEIL_DATA_SCIENCE_PING_CRON'
    ), {
        timezone: APP_TIMEZONE
    });

    cron.schedule(NEIL_CAPSTONE_PING_CRON, () => pingNeilInGeneral(
        'you have CST499 - Computer Science Capstone in 10 minutes, at 12:00 PM in BIT110!',
        'NEIL_CAPSTONE_PING_CRON'
    ), {
        timezone: APP_TIMEZONE
    });

    cron.schedule(NEIL_SERVICE_LEARNING_PING_CRON, () => pingNeilInGeneral(
        'you have CST462S - Race, Gender, Class in the Digital World in 10 minutes, at 10:00 AM in BIT224!',
        'NEIL_SERVICE_LEARNING_PING_CRON'
    ), {
        timezone: APP_TIMEZONE
    });

    console.log(`Daily quote scheduler started (${APP_TIMEZONE}).`);
    console.log(`Birthday scheduler started (${APP_TIMEZONE}).`);
    console.log(`My friend Neil\'s class reminder DMs are disabled (${APP_TIMEZONE}).`);
    console.log(`My friend Neil's general channel pings started (${APP_TIMEZONE}).`);
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
                (quote_text, quoted_person, added_by_user_id, added_by_username, used_in_daily_cycle)
                VALUES (?, ?, ?, ?, 0)
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

        else if (commandName === 'addshanword') {
            const word = interaction.options.getString('word').trim();
            const definition = interaction.options.getString('definition').trim();

            const [duplicateRows] = await pool.query(
                `
                SELECT id, word, definition
                FROM quote_bot_shanwords
                WHERE LOWER(TRIM(word)) = LOWER(TRIM(?))
                LIMIT 1
                `,
                [word]
            );

            if (duplicateRows.length > 0) {
                const existing = duplicateRows[0];

                await interaction.reply({
                    content:
                        `That word already exists as **#${existing.id}**.\n` +
                        `**${existing.word}**: ${existing.definition}`,
                    ephemeral: true
                });
                return;
            }

            const sql = `
                INSERT INTO quote_bot_shanwords
                (word, definition, added_by_user_id, added_by_username, used_in_daily_cycle)
                VALUES (?, ?, ?, ?, 0)
            `;

            const sqlParams = [
                word,
                definition,
                interaction.user.id,
                interaction.user.username
            ];

            const [result] = await pool.query(sql, sqlParams);

            await interaction.reply({
                content:
                    `Shanword added with ID **${result.insertId}**.\n` +
                    `**${word}**: ${definition}`,
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

        else if (commandName === 'deletebotmessage') {
            try {
                const botChannel = await client.channels.fetch(BOT_CHANNEL_ID);

                if (!botChannel || botChannel.type !== ChannelType.GuildText) {
                    await interaction.reply({
                        content: 'Bot channel not found.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.deferReply({ ephemeral: true });

                let deletedCount = 0;

                while (true) {
                    const messages = await botChannel.messages.fetch({ limit: 100 });

                    // Only bot messages
                    const botMessages = messages.filter(msg =>
                        msg.author.id === client.user.id
                    );

                    if (botMessages.size === 0) break;

                    const recentMessages = botMessages.filter(msg =>
                        Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
                    );

                    const oldMessages = botMessages.filter(msg =>
                        Date.now() - msg.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
                    );

                    // Bulk delete recent messages
                    if (recentMessages.size > 0) {
                        const deleted = await botChannel.bulkDelete(recentMessages, true);
                        deletedCount += deleted.size;
                    }

                    // Delete old messages one by one
                    for (const msg of oldMessages.values()) {
                        try {
                            await msg.delete();
                            deletedCount++;
                        } catch (err) {
                            console.error('Failed to delete old message:', err);
                        }
                    }

                    // If less than 100 messages fetched, we reached the end
                    if (messages.size < 100) break;
                }

                await interaction.editReply({
                    content: `🧹 Deleted ${deletedCount} bot messages in the bot channel.`
                });

            } catch (err) {
                console.error('deletebotmessage failed:', err);

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        content: 'Failed to clean bot messages.'
                    });
                } else {
                    await interaction.reply({
                        content: 'Failed to clean bot messages.',
                        ephemeral: true
                    });
                }
            }
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

            const output = rows.map(formatQuote).join('\n\n');

            await interaction.reply({
                content: output.length > 1900
                    ? output.slice(0, 1900) + '\n\n...'
                    : output,
                ephemeral: true
            });
        }

        else if (commandName === 'playthehits') {

            await interaction.deferReply({ ephemeral: true });

            try {

                console.time('playTheHits_total');

                const sql = `
                    SELECT
                        quoted_person,
                        quote_text
                    FROM quote_bot_quotes
                    WHERE quoted_person IN (
                        'Shannyn',
                        'Neil',
                        'Daniel',
                        'Tim',
                        'Kris',
                        'Jacob'
                    )
                `;

                console.time('sql_query');

                const [rows] = await pool.query(sql);

                console.timeEnd('sql_query');

                if (!rows.length) {

                    await interaction.editReply({
                        content: 'No quotes found.'
                    });

                    return;
                }

                // Group quotes by person
                const groupedQuotes = {};

                for (const row of rows) {

                    if (!groupedQuotes[row.quoted_person]) {
                        groupedQuotes[row.quoted_person] = [];
                    }

                    groupedQuotes[row.quoted_person].push(row);
                }

                // Pick one random quote per person
                const selectedQuotes = Object.values(groupedQuotes).map(quotes => {
                    return quotes[Math.floor(Math.random() * quotes.length)];
                });

                // Shuffle final output order
                selectedQuotes.sort(() => Math.random() - 0.5);

                const output =
                    'Playing the hits!\n\n' +
                    selectedQuotes.map(formatQuote).join('\n\n');

                console.time('fetch_channel');

                // Prefer cache over fetch for speed
                const generalChannel =
                    client.channels.cache.get(GENERAL_CHANNEL_ID);

                console.timeEnd('fetch_channel');

                if (!generalChannel) {

                    await interaction.editReply({
                        content: 'Could not find the general channel.'
                    });

                    return;
                }

                console.time('send_message');

                await generalChannel.send({
                    content:
                        output.length > 1900
                            ? output.slice(0, 1900) + '\n\n...'
                            : output
                });

                console.timeEnd('send_message');

                await interaction.editReply({
                    content: `Playing the hits in <#${GENERAL_CHANNEL_ID}>.`
                });

                console.timeEnd('playTheHits_total');

            } catch (err) {

                console.error('playTheHits error:', err);

                if (interaction.deferred || interaction.replied) {

                    await interaction.editReply({
                        content: 'Something went wrong.'
                    });

                } else {

                    await interaction.reply({
                        content: 'Something went wrong.',
                        ephemeral: true
                    });
                }
            }
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

        else if (commandName === 'editshanword') {
            const id = interaction.options.getInteger('id');
            const newWord = interaction.options.getString('word');
            const newDefinition = interaction.options.getString('definition');

            const [existingRows] = await pool.query(
                'SELECT * FROM quote_bot_shanwords WHERE id = ?',
                [id]
            );

            if (existingRows.length === 0) {
                await interaction.reply({
                    content: `Shanword ID **${id}** was not found.`,
                    ephemeral: true
                });
                return;
            }

            const existing = existingRows[0];

            const updatedWord = newWord ?? existing.word;
            const updatedDefinition = newDefinition ?? existing.definition;

            await pool.query(
                `
                UPDATE quote_bot_shanwords
                SET word = ?, definition = ?
                WHERE id = ?
                `,
                [updatedWord, updatedDefinition, id]
            );

            await interaction.reply({
                content:
                    `Shanword **#${id}** updated.\n` +
                    `**${updatedWord}**: ${updatedDefinition}`,
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

        else if (commandName === 'joke') {
            try {
                const joke = await getRandomJoke('Any');
                const generalChannel = await fetchGeneralChannel();

                await generalChannel.send({
                    content: `**Random Joke**\n${joke}`
                });

                await interaction.reply({
                    content: `Posted a random joke in <#${GENERAL_CHANNEL_ID}>.`,
                    ephemeral: true
                });
            } catch (err) {
                console.error('joke command failed:', err);

                await interaction.reply({
                    content: 'Could not fetch a joke right now.',
                    ephemeral: true
                });
            }
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

        else if (commandName === 'myfriendneil') {
            if (interaction.user.id === MY_FRIEND_NEIL) {
                await interaction.reply({
                    content: '❌ You cannot toggle this yourself, Neil.',
                    ephemeral: true
                });
                return;
            }

            neilPingsEnabled = !neilPingsEnabled;

            await interaction.reply({
                content: neilPingsEnabled
                    ? '🔔 Neil\'s class pings in this server are now **ON**.'
                    : '🔕 Neil\'s class pings in this server are now **OFF**.',
                ephemeral: true
            });
        }

        else if (commandName === 'quotebyid') {
            const id = interaction.options.getInteger('id');
            const row = await getQuoteById(id);

            if (!row) {
                await interaction.reply({
                    content: `Quote ID **${id}** was not found.`,
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
                content: `Posted quote **#${id}** in <#${GENERAL_CHANNEL_ID}>.`,
                ephemeral: true
            });
        }

        else if (commandName === 'bjsolo') {
            if (activeBlackjackGames.has(interaction.user.id)) {
                await interaction.reply({
                    content: 'You already have a blackjack game in progress. Finish that one first.',
                    ephemeral: true
                });
                return;
            }

            const deck = buildShuffledDeck();
            const isRigged = interaction.user.id === DANIEL_USER_ID;

            const game = {
                deck,
                playerHand: [deck.pop(), deck.pop()],
                dealerHand: [deck.pop(), deck.pop()],
                isRigged
            };

            activeBlackjackGames.set(interaction.user.id, game);

            await interaction.reply({
                content: renderBlackjackTable(game, { revealDealer: false }),
                components: [buildBlackjackButtons()],
                ephemeral: true
            });

            const reply = await interaction.fetchReply();

            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 120000
            });

            collector.on('collect', async buttonInteraction => {
                if (buttonInteraction.customId === 'bj_hit') {
                    game.playerHand.push(
                        drawCardForHit(game.deck, game.playerHand, game.isRigged)
                    );

                    if (handValue(game.playerHand) > 21) {
                        activeBlackjackGames.delete(interaction.user.id);
                        collector.stop();

                        await buttonInteraction.update({
                            content:
                                renderBlackjackTable(game, { revealDealer: true }) +
                                '\n\n💥 **Bust! You lose.**',
                            components: []
                        });

                        if (game.isRigged) {
                            await sendBlackjackLossTaunt(interaction.user);
                        }
                        return;
                    }

                    await buttonInteraction.update({
                        content: renderBlackjackTable(game, { revealDealer: false }),
                        components: [buildBlackjackButtons()]
                    });
                    return;
                }

                // bj_stand
                while (handValue(game.dealerHand) < 17) {
                    game.dealerHand.push(drawFairCard(game.deck));
                }

                const outcome = resolveBlackjackOutcome(game.playerHand, game.dealerHand);

                activeBlackjackGames.delete(interaction.user.id);
                collector.stop();

                await buttonInteraction.update({
                    content: renderBlackjackTable(game, { revealDealer: true }) + `\n\n${outcome.message}`,
                    components: []
                });

                if (game.isRigged && outcome.result === 'lose') {
                    await sendBlackjackLossTaunt(interaction.user);
                }
            });

            collector.on('end', async (_collected, reason) => {
                if (reason !== 'time') return;

                activeBlackjackGames.delete(interaction.user.id);

                await reply.edit({
                    content:
                        renderBlackjackTable(game, { revealDealer: true }) +
                        '\n\n⏰ **Game timed out.**',
                    components: []
                }).catch(() => {});
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

client.on(Events.MessageCreate, async message => {
    try {
        // Ignores bots
        if (message.author.bot) {
            return;
        }

        // Only runs this code in the general channel
        if (message.channelId !== GENERAL_CHANNEL_ID) {
            return;
        }

        // Normalizes the message for case-insensitive checks
        const content = message.content.toLowerCase();

        // @everyone detector
        if (message.mentions.everyone) {
            await message.react('1499476464683323463'); // Reacts with specified emote when @everyone used
            await message.react('1499892336161718430');
            await message.react('1545294906493247579');
        }

        // =========================================
        // Keyword → emoji reaction system
        // =========================================
        const keywordReactions = [
            {
                words: [
                    'fish', 'tilapia', 'tuna', 'salmon',
                    'cod', 'trout', 'bass', 'catfish',
                    'sardine', 'anchovy', 'mackerel',
                    'halibut', 'snapper'
                ],
                emoji: '1499476519028916254'
            },
            {
                words: ['plane', 'airplane', 'jet', 'flight', 'planes', 'daniel'],
                emoji: '1499479493331386470'
            },
            {
                words: ['penis', 'goon', 'gooning', 'pussy', 'dick', 'cock', 'gooner', 'hentai', 'cum',
                    'cumming', 'sex',
                ],
                emoji: '1499518517311963166'
            },
            {
                words: ['67', '6 7', 'six seven', 'sixseven', 'sixty seven', 'brainrot'],
                emoji: '1501600308172689438'
            },
        ];

        for (const entry of keywordReactions) {
            if (entry.words.some(word => content.includes(word))) {
                await message.react(entry.emoji);
            }
        }

        // // Reacts specified emote to a specific person
        // if (message.author.id === SIX_SEVEN_VICTIM){
        //     await message.react('1499114764482117693');
        // }
        

    } catch (err) {
        console.error('Message handler failed:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);