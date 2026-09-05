// legacy.js
//
// Archive of removed/disabled features from index.js, kept for reference or
// in case any of it needs to come back later. Nothing in this file is
// imported or executed — it is not part of the live bot.
//
// Each section below includes the constants/helper functions it depended on
// that no longer exist in index.js, plus the original commented-out code
// exactly as it was. Anything NOT listed here (fetchGeneralChannel,
// getRandomQuote, formatQuote, rememberLastQuote, lastPostedQuoteId,
// client.users.fetch, MY_FRIEND_NEIL, pingNeilInGeneral) is still live in
// index.js and would just need to be imported/passed in to revive a section.

// ============================================================
// SECTION 1: Hourly random quote posting (@everyone ping)
//
// Every hour, rolled a chance to post a random quote to @everyone. Each miss
// increased the odds by 0.25% for the next hour; a hit reset the odds back
// down to the base chance.
// ============================================================

// Every hour at minute 0 LA time
const HOURLY_CHANCE_CRON = '0 * * * *';

// Hourly chance system
const BASE_HOURLY_CHANCE = 1;
let currentHourlyChance = BASE_HOURLY_CHANCE; // starts the currently hourly chance at a base 5%

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


// ============================================================
// SECTION 2: "67" daily ping
//
// Posted "<@SIX_SEVEN_VICTIM> 67" (Shannyn) to the general channel once a day.
// ============================================================

// Every day at 6:07 PM LA time
const SIXTY_SEVEN_CRON = '7 18 * * *';

// Hardcoded 67 ping target
const SIX_SEVEN_VICTIM = process.env.SHANNYN_DISCORD_ID; // AKA Shannyn

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


// ============================================================
// SECTION 3: "67" DM spam (temporary)
//
// Sent Shannyn 67 individual DMs, paced out evenly over 60 seconds, once a
// day at 6:07 PM (same cron as section 2 — only one of the two ever ran at
// a time).
// ============================================================

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


// ============================================================
// SECTION 4: Neil's class reminder DMs
//
// DMed Neil directly 30 minutes before each of his four recurring classes.
// Replaced by the general-channel ping system (pingNeilInGeneral, still live
// in index.js) plus the /myfriendneil on/off toggle.
// ============================================================

//Every Tuesday, Thursday at 3:30 PM LA time
const NEIL_LOGIC_CRON = '30 15 * * 2,4'

//Every Tuesday, Thursday at 1:30 PM LA time
const NEIL_DATA_SCIENCE_CRON = '30 13 * * 2,4'

//Every Wednesday, Friday at 11:30 AM LA time
const NEIL_CAPSTONE_CRON = '30 11 * * 3,5'

//Every Friday at 9:30 AM LA time (this is the important one, apparently)
const NEIL_SERVICE_LEARNING_CRON = '30 9 * * 5'

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


// ============================================================
// SECTION 5: Single-person keyword reaction
//
// Reacted with a specific emote whenever Shannyn (SIX_SEVEN_VICTIM, see
// section 2) posted any message at all in the general channel.
// ============================================================

// // Reacts specified emote to a specific person
// if (message.author.id === SIX_SEVEN_VICTIM){
//     await message.react('1499114764482117693');
// }
