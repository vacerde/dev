#!/usr/bin/env node

/**
 * PostgreSQL CLI Tool
 * A comprehensive tool for testing connections and performing CRUD operations on any PostgreSQL database
 * 
 * Features:
 * - Connection testing with detailed diagnostics
 * - List and describe tables
 * - Full CRUD operations (Create, Read, Update, Delete)
 * - Interactive mode
 * - Debug mode with verbose logging
 * - Beautiful formatted output
 * - Helpful error messages
 */

import pg from 'pg';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';

const { Client } = pg;

// ============================================================================
// DEBUG MODULE
// ============================================================================

let debugMode = false;

function setDebugMode(enabled) {
  debugMode = enabled;
}

function isDebugMode() {
  return debugMode;
}

function debugLog(message, data = null) {
  if (!debugMode) return;
  
  const timestamp = new Date().toISOString();
  console.log(chalk.gray(`[DEBUG ${timestamp}] ${message}`));
  
  if (data) {
    console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }
}

function debugError(error) {
  if (!debugMode) return;
  
  console.log(chalk.red('\n[DEBUG ERROR] Full stack trace:'));
  console.log(chalk.gray(error.stack));
}

// ============================================================================
// DATABASE MODULE
// ============================================================================

async function testConnection(connectionString) {
  debugLog('Initiating connection test...');
  
  const startTime = Date.now();
  const client = new Client({ connectionString });

  try {
    debugLog('Attempting to connect to database...');
    await client.connect();
    
    debugLog('Connection established, testing query...');
    const result = await client.query('SELECT version(), current_database(), current_user, now()');
    
    const duration = Date.now() - startTime;
    
    console.log(chalk.green('✓ Connection successful!'));
    console.log(chalk.cyan('\nDatabase Information:'));
    console.log(chalk.white(`  PostgreSQL Version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`));
    console.log(chalk.white(`  Database Name: ${result.rows[0].current_database}`));
    console.log(chalk.white(`  Connected User: ${result.rows[0].current_user}`));
    console.log(chalk.white(`  Server Time: ${result.rows[0].now}`));
    console.log(chalk.white(`  Connection Time: ${duration}ms`));
    
    debugLog(`Connection test completed in ${duration}ms`);
    
  } catch (error) {
    debugLog(`Connection failed: ${error.message}`);
    
    if (error.code === 'ENOTFOUND') {
      console.error(chalk.red('\n❌ Host not found. Check your connection string.'));
      debugLog('DNS resolution failed for host');
    } else if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('\n❌ Connection refused. Is PostgreSQL running?'));
      debugLog('Connection was refused by the server');
    } else if (error.code === '28P01') {
      console.error(chalk.red('\n❌ Authentication failed. Check your username/password.'));
      debugLog('Authentication credentials were rejected');
    } else if (error.code === '3D000') {
      console.error(chalk.red('\n❌ Database does not exist.'));
      debugLog('Specified database name does not exist');
    } else {
      console.error(chalk.red(`\n❌ Connection error: ${error.message}`));
      debugLog(`Error code: ${error.code}`);
    }
    
    throw error;
    
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

async function getClient(connectionString) {
  debugLog('Creating new database client...');
  const client = new Client({ connectionString });
  
  try {
    debugLog('Connecting to database...');
    await client.connect();
    debugLog('Client connected successfully');
    return client;
  } catch (error) {
    debugLog(`Failed to create client: ${error.message}`);
    throw error;
  }
}

async function executeQuery(client, query, params = []) {
  debugLog(`Executing query: ${query}`);
  if (params.length > 0) {
    debugLog(`Query parameters: ${JSON.stringify(params)}`);
  }
  
  const startTime = Date.now();
  
  try {
    const result = await client.query(query, params);
    const duration = Date.now() - startTime;
    
    debugLog(`Query executed successfully in ${duration}ms`);
    debugLog(`Rows affected/returned: ${result.rowCount || result.rows.length}`);
    
    return result;
    
  } catch (error) {
    debugLog(`Query failed: ${error.message}`);
    debugLog(`Error code: ${error.code}`);
    
    // Provide helpful error messages
    if (error.code === '42P01') {
      throw new Error(`Table does not exist. ${error.message}`);
    } else if (error.code === '42703') {
      throw new Error(`Column does not exist. ${error.message}`);
    } else if (error.code === '23505') {
      throw new Error(`Duplicate key violation. ${error.message}`);
    } else if (error.code === '23503') {
      throw new Error(`Foreign key constraint violation. ${error.message}`);
    } else if (error.code === '23502') {
      throw new Error(`NOT NULL constraint violation. ${error.message}`);
    } else if (error.code === '22P02') {
      throw new Error(`Invalid input syntax. ${error.message}`);
    } else {
      throw error;
    }
  }
}

// ============================================================================
// SCHEMA MODULE
// ============================================================================

async function listTables(connectionString) {
  const client = await getClient(connectionString);
  
  try {
    debugLog('Fetching list of tables...');
    
    const query = `
      SELECT 
        schemaname,
        tablename,
        tableowner
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename;
    `;
    
    const result = await executeQuery(client, query);
    
    if (result.rows.length === 0) {
      console.log(chalk.yellow('\n⚠️  No tables found in the database'));
      return;
    }
    
    console.log(chalk.green(`\n✓ Found ${result.rows.length} table(s):\n`));
    
    const table = new Table({
      head: [
        chalk.cyan('Schema'),
        chalk.cyan('Table Name'),
        chalk.cyan('Owner')
      ],
      style: {
        head: [],
        border: []
      }
    });
    
    result.rows.forEach(row => {
      table.push([
        row.schemaname,
        chalk.white(row.tablename),
        row.tableowner
      ]);
    });
    
    console.log(table.toString());
    
    // Get row counts
    console.log(chalk.cyan('\nRow Counts:'));
    for (const row of result.rows) {
      const fullTableName = row.schemaname === 'public' 
        ? row.tablename 
        : `${row.schemaname}.${row.tablename}`;
      
      try {
        const countResult = await executeQuery(
          client, 
          `SELECT COUNT(*) FROM ${fullTableName}`
        );
        console.log(chalk.white(`  ${fullTableName}: ${countResult.rows[0].count} row(s)`));
      } catch (error) {
        debugLog(`Failed to get count for ${fullTableName}: ${error.message}`);
      }
    }
    
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

async function describeTable(connectionString, tableName) {
  const client = await getClient(connectionString);
  
  try {
    debugLog(`Describing table: ${tableName}`);
    
    // Get column information
    const columnQuery = `
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = $1
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY ordinal_position;
    `;
    
    const columnResult = await executeQuery(client, columnQuery, [tableName]);
    
    if (columnResult.rows.length === 0) {
      console.log(chalk.red(`\n❌ Table '${tableName}' not found`));
      return;
    }
    
    console.log(chalk.green(`\n✓ Table: ${chalk.white(tableName)}\n`));
    
    // Display columns
    const columnTable = new Table({
      head: [
        chalk.cyan('Column'),
        chalk.cyan('Type'),
        chalk.cyan('Nullable'),
        chalk.cyan('Default')
      ],
      style: {
        head: [],
        border: []
      }
    });
    
    columnResult.rows.forEach(col => {
      let dataType = col.data_type;
      if (col.character_maximum_length) {
        dataType += `(${col.character_maximum_length})`;
      }
      
      columnTable.push([
        chalk.white(col.column_name),
        dataType,
        col.is_nullable === 'YES' ? chalk.gray('NULL') : chalk.yellow('NOT NULL'),
        col.column_default || chalk.gray('-')
      ]);
    });
    
    console.log(columnTable.toString());
    
    // Get primary keys
    const pkQuery = `
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
        AND i.indisprimary;
    `;
    
    const pkResult = await executeQuery(client, pkQuery, [tableName]);
    
    if (pkResult.rows.length > 0) {
      console.log(chalk.cyan('\nPrimary Key(s):'));
      pkResult.rows.forEach(pk => {
        console.log(chalk.white(`  • ${pk.attname}`));
      });
    }
    
    // Get foreign keys
    const fkQuery = `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1;
    `;
    
    const fkResult = await executeQuery(client, fkQuery, [tableName]);
    
    if (fkResult.rows.length > 0) {
      console.log(chalk.cyan('\nForeign Key(s):'));
      fkResult.rows.forEach(fk => {
        console.log(chalk.white(`  • ${fk.column_name} → ${fk.foreign_table_name}(${fk.foreign_column_name})`));
      });
    }
    
    // Get indexes
    const indexQuery = `
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = $1
        AND schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY indexname;
    `;
    
    const indexResult = await executeQuery(client, indexQuery, [tableName]);
    
    if (indexResult.rows.length > 0) {
      console.log(chalk.cyan('\nIndexes:'));
      indexResult.rows.forEach(idx => {
        console.log(chalk.white(`  • ${idx.indexname}`));
        debugLog(`Index definition: ${idx.indexdef}`);
      });
    }
    
    // Get row count
    const countResult = await executeQuery(client, `SELECT COUNT(*) FROM ${tableName}`);
    console.log(chalk.cyan(`\nTotal Rows: ${chalk.white(countResult.rows[0].count)}`));
    
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

// ============================================================================
// CRUD MODULE
// ============================================================================

async function createRecord(connectionString, tableName, data) {
  const client = await getClient(connectionString);
  
  try {
    debugLog(`Creating record in table: ${tableName}`);
    debugLog('Data to insert:', data);
    
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    
    const query = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *;
    `;
    
    debugLog(`Generated SQL: ${query}`);
    
    const result = await executeQuery(client, query, values);
    
    console.log(chalk.green('\n✓ Record created successfully!\n'));
    
    // Display the created record
    const table = new Table({
      head: Object.keys(result.rows[0]).map(k => chalk.cyan(k)),
      style: { head: [], border: [] }
    });
    
    table.push(Object.values(result.rows[0]).map(v => {
      if (v === null) return chalk.gray('NULL');
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }));
    
    console.log(table.toString());
    
  } catch (error) {
    if (error.message.includes('duplicate key')) {
      console.error(chalk.red('\n❌ Cannot create record: Duplicate key constraint violation'));
      console.log(chalk.yellow('A record with this unique value already exists'));
    } else if (error.message.includes('NOT NULL')) {
      console.error(chalk.red('\n❌ Cannot create record: Required field is missing'));
      console.log(chalk.yellow('Some columns require a value (NOT NULL constraint)'));
    } else if (error.message.includes('foreign key')) {
      console.error(chalk.red('\n❌ Cannot create record: Foreign key constraint violation'));
      console.log(chalk.yellow('Referenced record does not exist in the related table'));
    }
    throw error;
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

async function readRecords(connectionString, tableName, options = {}) {
  const client = await getClient(connectionString);
  
  try {
    debugLog(`Reading records from table: ${tableName}`);
    debugLog('Query options:', options);
    
    let query = `SELECT * FROM ${tableName}`;
    const params = [];
    let paramCount = 0;
    
    // Build WHERE clause
    if (options.where) {
      const whereConditions = [];
      const whereValues = [];
      
      for (const [key, value] of Object.entries(options.where)) {
        paramCount++;
        whereConditions.push(`${key} = $${paramCount}`);
        whereValues.push(value);
      }
      
      query += ` WHERE ${whereConditions.join(' AND ')}`;
      params.push(...whereValues);
    }
    
    // Add ORDER BY
    if (options.sort) {
      query += ` ORDER BY ${options.sort}`;
      if (options.desc) {
        query += ' DESC';
      }
    }
    
    // Add LIMIT
    if (options.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(options.limit);
    }
    
    // Add OFFSET
    if (options.offset && options.offset > 0) {
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(options.offset);
    }
    
    debugLog(`Generated SQL: ${query}`);
    
    const result = await executeQuery(client, query, params);
    
    if (result.rows.length === 0) {
      console.log(chalk.yellow('\n⚠️  No records found matching the criteria'));
      return;
    }
    
    console.log(chalk.green(`\n✓ Found ${result.rows.length} record(s):\n`));
    
    // Display results in a table
    const table = new Table({
      head: Object.keys(result.rows[0]).map(k => chalk.cyan(k)),
      style: { head: [], border: [] }
    });
    
    result.rows.forEach(row => {
      table.push(Object.values(row).map(v => {
        if (v === null) return chalk.gray('NULL');
        if (typeof v === 'object') return JSON.stringify(v);
        if (typeof v === 'boolean') return v ? chalk.green('true') : chalk.red('false');
        return String(v);
      }));
    });
    
    console.log(table.toString());
    
    // Show pagination info
    if (options.limit || options.offset) {
      console.log(chalk.cyan(`\nShowing records ${options.offset + 1} to ${options.offset + result.rows.length}`));
      if (options.limit && result.rows.length === options.limit) {
        console.log(chalk.yellow('More records may be available. Use --offset to see more.'));
      }
    }
    
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

async function updateRecord(connectionString, tableName, data, where) {
  const client = await getClient(connectionString);
  
  try {
    debugLog(`Updating records in table: ${tableName}`);
    debugLog('Update data:', data);
    debugLog('WHERE conditions:', where);
    
    // First, check how many records will be affected
    const whereConditions = [];
    const whereValues = [];
    let paramCount = 0;
    
    for (const [key, value] of Object.entries(where)) {
      paramCount++;
      whereConditions.push(`${key} = $${paramCount}`);
      whereValues.push(value);
    }
    
    const checkQuery = `SELECT COUNT(*) FROM ${tableName} WHERE ${whereConditions.join(' AND ')}`;
    const checkResult = await executeQuery(client, checkQuery, whereValues);
    const affectedCount = parseInt(checkResult.rows[0].count);
    
    if (affectedCount === 0) {
      console.log(chalk.yellow('\n⚠️  No records found matching the WHERE clause'));
      return;
    }
    
    console.log(chalk.yellow(`\n⚠️  This will update ${affectedCount} record(s)`));
    
    // Build UPDATE query
    const setConditions = [];
    const setValues = [];
    
    for (const [key, value] of Object.entries(data)) {
      paramCount++;
      setConditions.push(`${key} = $${paramCount}`);
      setValues.push(value);
    }
    
    const query = `
      UPDATE ${tableName}
      SET ${setConditions.join(', ')}
      WHERE ${whereConditions.join(' AND ')}
      RETURNING *;
    `;
    
    debugLog(`Generated SQL: ${query}`);
    
    const result = await executeQuery(client, query, [...setValues, ...whereValues]);
    
    console.log(chalk.green(`\n✓ Successfully updated ${result.rows.length} record(s)!\n`));
    
    // Display updated records
    const table = new Table({
      head: Object.keys(result.rows[0]).map(k => chalk.cyan(k)),
      style: { head: [], border: [] }
    });
    
    result.rows.forEach(row => {
      table.push(Object.values(row).map(v => {
        if (v === null) return chalk.gray('NULL');
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      }));
    });
    
    console.log(table.toString());
    
  } catch (error) {
    if (error.message.includes('foreign key')) {
      console.error(chalk.red('\n❌ Cannot update: Foreign key constraint violation'));
      console.log(chalk.yellow('The new value references a non-existent record'));
    }
    throw error;
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

async function deleteRecord(connectionString, tableName, where, force = false) {
  const client = await getClient(connectionString);
  
  try {
    debugLog(`Deleting records from table: ${tableName}`);
    debugLog('WHERE conditions:', where);
    
    // First, check how many records will be affected
    const whereConditions = [];
    const whereValues = [];
    let paramCount = 0;
    
    for (const [key, value] of Object.entries(where)) {
      paramCount++;
      whereConditions.push(`${key} = $${paramCount}`);
      whereValues.push(value);
    }
    
    const checkQuery = `SELECT * FROM ${tableName} WHERE ${whereConditions.join(' AND ')}`;
    const checkResult = await executeQuery(client, checkQuery, whereValues);
    
    if (checkResult.rows.length === 0) {
      console.log(chalk.yellow('\n⚠️  No records found matching the WHERE clause'));
      return;
    }
    
    console.log(chalk.yellow(`\n⚠️  This will delete ${checkResult.rows.length} record(s):`));
    
    // Show records that will be deleted
    const previewTable = new Table({
      head: Object.keys(checkResult.rows[0]).map(k => chalk.cyan(k)),
      style: { head: [], border: [] }
    });
    
    checkResult.rows.forEach(row => {
      previewTable.push(Object.values(row).map(v => {
        if (v === null) return chalk.gray('NULL');
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      }));
    });
    
    console.log(previewTable.toString());
    
    // Confirmation prompt
    if (!force) {
      const answer = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.red('Are you sure you want to delete these record(s)?'),
        default: false
      }]);
      
      if (!answer.confirm) {
        console.log(chalk.yellow('\n⚠️  Delete operation cancelled'));
        return;
      }
    }
    
    // Perform deletion
    const query = `
      DELETE FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      RETURNING *;
    `;
    
    debugLog(`Generated SQL: ${query}`);
    
    const result = await executeQuery(client, query, whereValues);
    
    console.log(chalk.green(`\n✓ Successfully deleted ${result.rows.length} record(s)!`));
    
  } catch (error) {
    if (error.message.includes('foreign key')) {
      console.error(chalk.red('\n❌ Cannot delete: Foreign key constraint violation'));
      console.log(chalk.yellow('This record is referenced by other records in the database'));
      console.log(chalk.yellow('Delete or update the referencing records first'));
    }
    throw error;
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

// ============================================================================
// INTERACTIVE MODE MODULE
// ============================================================================

async function interactiveMode(connectionString) {
  console.log(chalk.cyan('\n🚀 Welcome to PostgreSQL Interactive Mode!\n'));
  
  let client;
  try {
    client = await getClient(connectionString);
    console.log(chalk.green('✓ Connected to database\n'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to connect to database'));
    throw error;
  }
  
  try {
    // Main loop
    while (true) {
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📋 List all tables', value: 'list' },
          { name: '🔍 Describe a table', value: 'describe' },
          { name: '➕ Create a record (INSERT)', value: 'create' },
          { name: '📖 Read records (SELECT)', value: 'read' },
          { name: '✏️  Update records (UPDATE)', value: 'update' },
          { name: '🗑️  Delete records (DELETE)', value: 'delete' },
          { name: '🔌 Execute custom SQL', value: 'custom' },
          { name: '❌ Exit', value: 'exit' }
        ]
      }]);
      
      if (action === 'exit') {
        console.log(chalk.cyan('\n👋 Goodbye!\n'));
        break;
      }
      
      try {
        switch (action) {
          case 'list':
            await handleListTables(client);
            break;
          case 'describe':
            await handleDescribeTable(connectionString);
            break;
          case 'create':
            await handleCreate(connectionString, client);
            break;
          case 'read':
            await handleRead(connectionString, client);
            break;
          case 'update':
            await handleUpdate(connectionString, client);
            break;
          case 'delete':
            await handleDelete(connectionString, client);
            break;
          case 'custom':
            await handleCustomSQL(client);
            break;
        }
      } catch (error) {
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        debugLog(error.stack);
      }
      
      console.log(''); // Add spacing
    }
    
  } finally {
    await client.end();
    debugLog('Connection closed');
  }
}

async function handleListTables(client) {
  const query = `
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY tablename;
  `;
  
  const result = await executeQuery(client, query);
  
  if (result.rows.length === 0) {
    console.log(chalk.yellow('\n⚠️  No tables found'));
    return;
  }
  
  console.log(chalk.green(`\n✓ Tables in database:\n`));
  result.rows.forEach((row, i) => {
    console.log(chalk.white(`  ${i + 1}. ${row.tablename}`));
  });
}

async function handleDescribeTable(connectionString) {
  const { tableName } = await inquirer.prompt([{
    type: 'input',
    name: 'tableName',
    message: 'Enter table name:',
    validate: input => input.trim() !== '' || 'Table name is required'
  }]);
  
  await describeTable(connectionString, tableName.trim());
}

async function handleCreate(connectionString, client) {
  const { tableName } = await inquirer.prompt([{
    type: 'input',
    name: 'tableName',
    message: 'Enter table name:',
    validate: input => input.trim() !== '' || 'Table name is required'
  }]);
  
  // Get table columns
  const columns = await getTableColumns(client, tableName.trim());
  
  if (columns.length === 0) {
    console.log(chalk.red(`\n❌ Table '${tableName}' not found`));
    return;
  }
  
  console.log(chalk.cyan('\nEnter values for each column (leave blank for NULL):'));
  
  const data = {};
  
  for (const col of columns) {
    const isRequired = col.is_nullable === 'NO' && !col.column_default;
    const prompt = `${col.column_name} (${col.data_type})${isRequired ? ' *required*' : ''}:`;
    
    const { value } = await inquirer.prompt([{
      type: 'input',
      name: 'value',
      message: prompt,
      validate: input => {
        if (isRequired && input.trim() === '') {
          return 'This field is required';
        }
        return true;
      }
    }]);
    
    if (value.trim() !== '') {
      data[col.column_name] = convertValue(value, col.data_type);
    }
  }
  
  await createRecord(connectionString, tableName.trim(), data);
}

async function handleRead(connectionString, client) {
  const { tableName } = await inquirer.prompt([{
    type: 'input',
    name: 'tableName',
    message: 'Enter table name:',
    validate: input => input.trim() !== '' || 'Table name is required'
  }]);
  
  const { addWhere } = await inquirer.prompt([{
    type: 'confirm',
    name: 'addWhere',
    message: 'Add WHERE clause?',
    default: false
  }]);
  
  let where = null;
  if (addWhere) {
    const { whereJson } = await inquirer.prompt([{
      type: 'input',
      name: 'whereJson',
      message: 'Enter WHERE clause as JSON (e.g., {"id": 1}):',
      validate: input => {
        try {
          JSON.parse(input);
          return true;
        } catch {
          return 'Invalid JSON';
        }
      }
    }]);
    where = JSON.parse(whereJson);
  }
  
  const { limit } = await inquirer.prompt([{
    type: 'input',
    name: 'limit',
    message: 'Limit (number of records):',
    default: '10',
    validate: input => !isNaN(input) || 'Must be a number'
  }]);
  
  await readRecords(connectionString, tableName.trim(), {
    where,
    limit: parseInt(limit)
  });
}

async function handleUpdate(connectionString, client) {
  const { tableName } = await inquirer.prompt([{
    type: 'input',
    name: 'tableName',
    message: 'Enter table name:',
    validate: input => input.trim() !== '' || 'Table name is required'
  }]);
  
  const { whereJson } = await inquirer.prompt([{
    type: 'input',
    name: 'whereJson',
    message: 'WHERE clause as JSON (e.g., {"id": 1}):',
    validate: input => {
      if (input.trim() === '') return 'WHERE clause is required';
      try {
        JSON.parse(input);
        return true;
      } catch {
        return 'Invalid JSON';
      }
    }
  }]);
  
  const { dataJson } = await inquirer.prompt([{
    type: 'input',
    name: 'dataJson',
    message: 'Data to update as JSON (e.g., {"name": "John"}):',
    validate: input => {
      if (input.trim() === '') return 'Data is required';
      try {
        JSON.parse(input);
        return true;
      } catch {
        return 'Invalid JSON';
      }
    }
  }]);
  
  await updateRecord(
    connectionString,
    tableName.trim(),
    JSON.parse(dataJson),
    JSON.parse(whereJson)
  );
}

async function handleDelete(connectionString, client) {
  const { tableName } = await inquirer.prompt([{
    type: 'input',
    name: 'tableName',
    message: 'Enter table name:',
    validate: input => input.trim() !== '' || 'Table name is required'
  }]);
  
  const { whereJson } = await inquirer.prompt([{
    type: 'input',
    name: 'whereJson',
    message: 'WHERE clause as JSON (e.g., {"id": 1}):',
    validate: input => {
      if (input.trim() === '') return 'WHERE clause is required for safety';
      try {
        JSON.parse(input);
        return true;
      } catch {
        return 'Invalid JSON';
      }
    }
  }]);
  
  await deleteRecord(
    connectionString,
    tableName.trim(),
    JSON.parse(whereJson),
    false
  );
}

async function handleCustomSQL(client) {
  console.log(chalk.yellow('\n⚠️  Warning: Be careful with custom SQL queries!'));
  
  const { sql } = await inquirer.prompt([{
    type: 'input',
    name: 'sql',
    message: 'Enter SQL query:',
    validate: input => input.trim() !== '' || 'SQL query is required'
  }]);
  
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Execute this query?',
    default: false
  }]);
  
  if (!confirm) {
    console.log(chalk.yellow('\n⚠️  Query cancelled'));
    return;
  }
  
  const result = await executeQuery(client, sql.trim());
  
  if (result.rows && result.rows.length > 0) {
    console.log(chalk.green(`\n✓ Query returned ${result.rows.length} row(s):`));
    console.log(JSON.stringify(result.rows, null, 2));
  } else if (result.rowCount !== undefined) {
    console.log(chalk.green(`\n✓ Query executed. Rows affected: ${result.rowCount}`));
  } else {
    console.log(chalk.green('\n✓ Query executed successfully'));
  }
}

async function getTableColumns(client, tableName) {
  const query = `
    SELECT 
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_name = $1
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY ordinal_position;
  `;
  
  const result = await executeQuery(client, query, [tableName]);
  return result.rows;
}

function convertValue(value, dataType) {
  const trimmed = value.trim();
  
  if (dataType.includes('int') || dataType.includes('serial')) {
    return parseInt(trimmed);
  }
  
  if (dataType.includes('numeric') || dataType.includes('decimal') || dataType.includes('float') || dataType.includes('double')) {
    return parseFloat(trimmed);
  }
  
  if (dataType === 'boolean') {
    return trimmed.toLowerCase() === 'true' || trimmed === '1';
  }
  
  if (dataType === 'json' || dataType === 'jsonb') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  
  return trimmed;
}

// ============================================================================
// CLI PROGRAM
// ============================================================================

const program = new Command();

program
  .name('pgcli')
  .description('PostgreSQL CLI tool with CRUD operations for all tables')
  .version('1.0.0')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .option('-d, --debug', 'Enable debug mode with verbose logging')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().debug) {
      setDebugMode(true);
      debugLog('Debug mode enabled');
    }
  });

// Test connection command
program
  .command('test')
  .description('Test PostgreSQL connection')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .action(async (options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        console.log(chalk.yellow('Use -c flag, --connection option, or set DATABASE_URL environment variable'));
        process.exit(1);
      }

      debugLog(`Testing connection: ${connString.replace(/:[^:@]+@/, ':****@')}`);
      await testConnection(connString);
      
    } catch (error) {
      console.error(chalk.red('❌ Connection test failed:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// List tables command
program
  .command('tables')
  .description('List all tables in the database')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .action(async (options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      await listTables(connString);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Describe table command
program
  .command('describe <table>')
  .description('Describe table structure (columns, types, constraints)')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .action(async (table, options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      await describeTable(connString, table);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Create (INSERT) command
program
  .command('create <table>')
  .description('Create a new record in the specified table')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .option('-d, --data <json>', 'JSON data for the new record')
  .action(async (table, options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      if (!options.data) {
        console.error(chalk.red('❌ Error: No data provided'));
        console.log(chalk.yellow('Use -d or --data flag with JSON data'));
        console.log(chalk.cyan('Example: node pgcli.js create users -d \'{"name":"John","email":"john@example.com"}\''));
        process.exit(1);
      }

      const data = JSON.parse(options.data);
      await createRecord(connString, table, data);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Read (SELECT) command
program
  .command('read <table>')
  .description('Read records from the specified table')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .option('-w, --where <json>', 'WHERE clause as JSON (e.g., \'{"id": 1}\')')
  .option('-l, --limit <number>', 'Limit number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-s, --sort <column>', 'Sort by column')
  .option('--desc', 'Sort in descending order')
  .action(async (table, options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      const queryOptions = {
        where: options.where ? JSON.parse(options.where) : null,
        limit: parseInt(options.limit),
        offset: parseInt(options.offset),
        sort: options.sort,
        desc: options.desc || false
      };

      await readRecords(connString, table, queryOptions);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Update command
program
  .command('update <table>')
  .description('Update records in the specified table')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .option('-w, --where <json>', 'WHERE clause as JSON (e.g., \'{"id": 1}\')')
  .option('-d, --data <json>', 'JSON data to update')
  .action(async (table, options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      if (!options.data) {
        console.error(chalk.red('❌ Error: No data provided'));
        console.log(chalk.yellow('Use -d or --data flag with JSON data'));
        process.exit(1);
      }

      if (!options.where) {
        console.error(chalk.red('❌ Error: No WHERE clause provided'));
        console.log(chalk.yellow('Use -w or --where flag to specify which records to update'));
        console.log(chalk.cyan('Example: node pgcli.js update users -w \'{"id":1}\' -d \'{"name":"Jane"}\''));
        process.exit(1);
      }

      const data = JSON.parse(options.data);
      const where = JSON.parse(options.where);
      
      await updateRecord(connString, table, data, where);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Delete command
program
  .command('delete <table>')
  .description('Delete records from the specified table')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .option('-w, --where <json>', 'WHERE clause as JSON (e.g., \'{"id": 1}\')')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (table, options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      if (!options.where) {
        console.error(chalk.red('❌ Error: No WHERE clause provided'));
        console.log(chalk.yellow('Use -w or --where flag to specify which records to delete'));
        console.log(chalk.red('⚠️  To prevent accidental data loss, WHERE clause is required'));
        process.exit(1);
      }

      const where = JSON.parse(options.where);
      
      await deleteRecord(connString, table, where, options.force);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Interactive mode
program
  .command('interactive')
  .alias('i')
  .description('Enter interactive mode for easier CRUD operations')
  .option('-c, --connection <string>', 'PostgreSQL connection string')
  .action(async (options) => {
    try {
      const connString = options.connection || program.opts().connection || process.env.DATABASE_URL;
      
      if (!connString) {
        console.error(chalk.red('❌ Error: No connection string provided'));
        process.exit(1);
      }

      await interactiveMode(connString);
      
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      debugLog(error.stack);
      process.exit(1);
    }
  });

// Parse and execute
program.parse();