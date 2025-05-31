require('dotenv').config();
const mysql = require('mysql2/promise');
const readline = require('readline');

// Your JDBC connection string
const jdbcConnectionString = process.env.JDBC_CONNECTION_STRING;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to parse JDBC connection string
function parseJdbcConnectionString(jdbcUrl) {
  const mysqlUrl = jdbcUrl.replace(/^jdbc:/, '');
  const url = new URL(mysqlUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.substring(1)
  };
}

// Parse connection details
const connectionConfig = parseJdbcConnectionString(jdbcConnectionString);

// Utility function to format table output
function formatTable(data, maxWidth = 100) {
  if (!data || data.length === 0) return 'No data found.';
  
  const columns = Object.keys(data[0]);
  const colWidths = {};
  
  // Calculate column widths
  columns.forEach(col => {
    colWidths[col] = Math.max(
      col.length,
      ...data.map(row => String(row[col] || '').length)
    );
    // Limit column width for readability
    colWidths[col] = Math.min(colWidths[col], 30);
  });
  
  // Create header
  let result = '┌' + columns.map(col => '─'.repeat(colWidths[col] + 2)).join('┬') + '┐\n';
  result += '│' + columns.map(col => ` ${col.padEnd(colWidths[col])} `).join('│') + '│\n';
  result += '├' + columns.map(col => '─'.repeat(colWidths[col] + 2)).join('┼') + '┤\n';
  
  // Add data rows
  data.forEach(row => {
    result += '│' + columns.map(col => {
      let value = String(row[col] || '');
      if (value.length > 30) value = value.substring(0, 27) + '...';
      return ` ${value.padEnd(colWidths[col])} `;
    }).join('│') + '│\n';
  });
  
  result += '└' + columns.map(col => '─'.repeat(colWidths[col] + 2)).join('┴') + '┘';
  return result;
}

// Function to prompt user input
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Function to display available tables
async function showTables(connection) {
  try {
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('\n📋 Available Tables:');
    console.log('==================');
    tables.forEach((table, index) => {
      const tableName = Object.values(table)[0];
      console.log(`${index + 1}. ${tableName}`);
    });
    return tables.map(table => Object.values(table)[0]);
  } catch (error) {
    console.error('❌ Error fetching tables:', error.message);
    return [];
  }
}

// Function to describe table structure
async function describeTable(connection, tableName) {
  try {
    const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
    console.log(`\n📊 Table Structure: ${tableName}`);
    console.log('================================');
    console.log(formatTable(columns));
    
    // Get row count
    const [countResult] = await connection.execute(`SELECT COUNT(*) as total_rows FROM ${tableName}`);
    console.log(`\n📈 Total rows: ${countResult[0].total_rows}`);
  } catch (error) {
    console.error('❌ Error describing table:', error.message);
  }
}

// Function to show table data
async function showTableData(connection, tableName, limit = 10) {
  try {
    const [rows] = await connection.execute(`SELECT * FROM ${tableName} LIMIT ?`, [limit]);
    
    if (rows.length === 0) {
      console.log(`\n📭 No data found in table '${tableName}'`);
      return;
    }
    
    console.log(`\n📄 Data from table '${tableName}' (first ${limit} rows):`);
    console.log('='.repeat(50));
    console.log(formatTable(rows));
    
    // Show total count
    const [countResult] = await connection.execute(`SELECT COUNT(*) as total_rows FROM ${tableName}`);
    console.log(`\nShowing ${rows.length} of ${countResult[0].total_rows} total rows`);
    
  } catch (error) {
    console.error('❌ Error fetching table data:', error.message);
  }
}

// Function to search in table
async function searchInTable(connection, tableName) {
  try {
    // Get table columns first
    const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
    const columnNames = columns.map(col => col.Field);
    
    console.log(`\n🔍 Available columns for search in '${tableName}':`);
    columnNames.forEach((col, index) => {
      console.log(`${index + 1}. ${col}`);
    });
    
    const columnChoice = await askQuestion('\nEnter column number to search in (or press Enter to skip): ');
    
    if (!columnChoice) return;
    
    const columnIndex = parseInt(columnChoice) - 1;
    if (columnIndex < 0 || columnIndex >= columnNames.length) {
      console.log('❌ Invalid column number');
      return;
    }
    
    const selectedColumn = columnNames[columnIndex];
    const searchValue = await askQuestion(`Enter search value for column '${selectedColumn}': `);
    
    if (!searchValue) return;
    
    const [rows] = await connection.execute(
      `SELECT * FROM ${tableName} WHERE ${selectedColumn} LIKE ? LIMIT 10`,
      [`%${searchValue}%`]
    );
    
    if (rows.length === 0) {
      console.log(`\n📭 No results found for '${searchValue}' in column '${selectedColumn}'`);
      return;
    }
    
    console.log(`\n🎯 Search results for '${searchValue}' in '${selectedColumn}':`);
    console.log('='.repeat(50));
    console.log(formatTable(rows));
    
  } catch (error) {
    console.error('❌ Error searching in table:', error.message);
  }
}

// Main interactive menu
async function showMainMenu(connection, tables) {
  while (true) {
    console.log('\n🚀 MySQL Database Browser');
    console.log('========================');
    console.log('1. List all tables');
    console.log('2. Select and view table data');
    console.log('3. Describe table structure');
    console.log('4. Search in table');
    console.log('5. Execute custom query');
    console.log('6. Exit');
    
    const choice = await askQuestion('\nEnter your choice (1-6): ');
    
    switch (choice) {
      case '1':
        await showTables(connection);
        break;
        
      case '2':
        if (tables.length === 0) {
          console.log('❌ No tables available');
          break;
        }
        
        console.log('\n📋 Select a table:');
        tables.forEach((table, index) => {
          console.log(`${index + 1}. ${table}`);
        });
        
        const tableChoice = await askQuestion('\nEnter table number: ');
        const tableIndex = parseInt(tableChoice) - 1;
        
        if (tableIndex >= 0 && tableIndex < tables.length) {
          const selectedTable = tables[tableIndex];
          const limit = await askQuestion('Enter number of rows to display (default 10): ') || '10';
          await showTableData(connection, selectedTable, parseInt(limit));
        } else {
          console.log('❌ Invalid table number');
        }
        break;
        
      case '3':
        if (tables.length === 0) {
          console.log('❌ No tables available');
          break;
        }
        
        console.log('\n📋 Select a table to describe:');
        tables.forEach((table, index) => {
          console.log(`${index + 1}. ${table}`);
        });
        
        const descTableChoice = await askQuestion('\nEnter table number: ');
        const descTableIndex = parseInt(descTableChoice) - 1;
        
        if (descTableIndex >= 0 && descTableIndex < tables.length) {
          await describeTable(connection, tables[descTableIndex]);
        } else {
          console.log('❌ Invalid table number');
        }
        break;
        
      case '4':
        if (tables.length === 0) {
          console.log('❌ No tables available');
          break;
        }
        
        console.log('\n📋 Select a table to search:');
        tables.forEach((table, index) => {
          console.log(`${index + 1}. ${table}`);
        });
        
        const searchTableChoice = await askQuestion('\nEnter table number: ');
        const searchTableIndex = parseInt(searchTableChoice) - 1;
        
        if (searchTableIndex >= 0 && searchTableIndex < tables.length) {
          await searchInTable(connection, tables[searchTableIndex]);
        } else {
          console.log('❌ Invalid table number');
        }
        break;
        
      case '5':
        const customQuery = await askQuestion('\nEnter your SQL query: ');
        if (customQuery) {
          try {
            const [results] = await connection.execute(customQuery);
            if (Array.isArray(results) && results.length > 0) {
              console.log('\n📄 Query Results:');
              console.log('================');
              console.log(formatTable(results.slice(0, 10))); // Limit to 10 results
              if (results.length > 10) {
                console.log(`\nShowing first 10 of ${results.length} results`);
              }
            } else {
              console.log('\n✅ Query executed successfully');
              console.log('Result:', results);
            }
          } catch (error) {
            console.error('❌ Query error:', error.message);
          }
        }
        break;
        
      case '6':
        console.log('👋 Goodbye!');
        return;
        
      default:
        console.log('❌ Invalid choice. Please enter 1-6.');
    }
    
    await askQuestion('\nPress Enter to continue...');
  }
}

// Main application function
async function main() {
  let connection;
  
  try {
    console.log('🚀 Starting MySQL Database Browser...\n');
    console.log('Connection Details:');
    console.log('Host:', connectionConfig.host);
    console.log('Port:', connectionConfig.port);
    console.log('User:', connectionConfig.user);
    console.log('Database:', connectionConfig.database);
    console.log('');
    
    // Create connection
    connection = await mysql.createConnection(connectionConfig);
    console.log('✅ Successfully connected to MySQL database\n');
    
    // Get available tables
    const tables = await showTables(connection);
    
    if (tables.length === 0) {
      console.log('❌ No tables found in the database');
      return;
    }
    
    // Start interactive menu
    await showMainMenu(connection, tables);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Handle specific error cases
    if (error.code === 'ECONNREFUSED') {
      console.error('🔌 MySQL server is not running or connection refused');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('🔐 Access denied - check username and password');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('🗃️ Database does not exist');
    } else if (error.code === 'ENOTFOUND') {
      console.error('🌐 Host not found - check the hostname');
    }
  } finally {
    // Close connection and readline interface
    if (connection) {
      await connection.end();
      console.log('🔌 Connection closed');
    }
    rl.close();
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Exiting...');
  rl.close();
  process.exit(0);
});

// Run the application
main().catch(console.error);