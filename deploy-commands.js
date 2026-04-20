import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

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
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('deletequote')
        .setDescription('Delete a quote by ID')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('Quote ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('everyonequote')
        .setDescription('Ping everyone in general with a random quote')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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