import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
    new SlashCommandBuilder()
        .setName('addquote')
        .setDescription('Add a new quote')
        .addStringOption(option =>
            option.setName('person')
                .setDescription('Who said the quote')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('quote')
                .setDescription('The quote text')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('randomquote')
        .setDescription('Post a random quote in the general channel'),

    new SlashCommandBuilder()
        .setName('quotesbyperson')
        .setDescription('Post a random quote from a specific person in the general channel')
        .addStringOption(option =>
            option.setName('person')
                .setDescription('Person name')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('listquotes')
        .setDescription('List saved quotes')
        .addStringOption(option =>
            option.setName('person')
                .setDescription('Optional: filter by person')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show quote statistics'),

    new SlashCommandBuilder()
        .setName('addbirthday')
        .setDescription('Add or update a birthday for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Whose birthday this is')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('month')
                .setDescription('Birth month (1-12)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(12))
        .addIntegerOption(option =>
            option.setName('day')
                .setDescription('Birth day (1-31)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(31)),

    new SlashCommandBuilder()
        .setName('editquote')
        .setDescription('Edit an existing quote')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('Quote ID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('quote')
                .setDescription('New quote text')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('person')
                .setDescription('New person name')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('deletequote')
        .setDescription('Delete a quote by ID')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('Quote ID')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('everyonequote')
        .setDescription('Ping everyone in general with a random quote'),

    new SlashCommandBuilder()
    .setName('annoydaniel')
    .setDescription('Send Daniel a nice DM'),

    new SlashCommandBuilder()
        .setName('purebrainrot')
        .setDescription('Use at your own risk'),

    new SlashCommandBuilder()
        .setName('makedanielhappy')
        .setDescription('Send Daniel a random plane pic and who sent it'),

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
    console.log('Registering slash commands...');
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
    );
    console.log('Slash commands registered successfully.');
} catch (error) {
    console.error(error);
}