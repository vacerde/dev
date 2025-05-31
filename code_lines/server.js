#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Loading spinner
class Spinner {
  constructor(text = 'Loading...') {
    this.text = text;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.current = 0;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => {
      process.stdout.write(`\r${colors.cyan}${this.frames[this.current]}${colors.reset} ${this.text}`);
      this.current = (this.current + 1) % this.frames.length;
    }, 100);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
    }
  }

  updateText(text) {
    this.text = text;
  }
}

// Framework detection patterns
const FRAMEWORKS = {
  nextjs: {
    name: 'Next.js',
    icon: '⚡',
    patterns: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
    packageIndicators: ['next'],
    directories: ['pages', 'app'],
    categories: {
      pages: /\/(pages|app)\//,
      components: /\/(components|ui)\//,
      api: /\/api\//,
      hooks: /\/(hooks|composables)\//,
      utils: /\/(utils|lib|helpers)\//,
      styles: /\/(styles|css)\//,
      types: /\/(types|interfaces)\//,
      config: /\/(config|constants)\//,
      public: /\/public\//
    }
  },
  nuxtjs: {
    name: 'Nuxt.js',
    icon: '💚',
    patterns: ['nuxt.config.js', 'nuxt.config.ts'],
    packageIndicators: ['nuxt', '@nuxt/'],
    directories: ['pages', 'components', 'layouts'],
    categories: {
      pages: /\/(pages)\//,
      components: /\/(components)\//,
      layouts: /\/(layouts)\//,
      plugins: /\/(plugins)\//,
      middleware: /\/(middleware)\//,
      composables: /\/(composables)\//,
      utils: /\/(utils|lib)\//,
      assets: /\/(assets)\//,
      static: /\/(static|public)\//,
      server: /\/(server)\//
    }
  },
  vue: {
    name: 'Vue.js',
    icon: '🔥',
    patterns: ['vue.config.js', 'vite.config.js', 'vite.config.ts'],
    packageIndicators: ['vue', '@vue/'],
    directories: ['src'],
    categories: {
      components: /\/(components|views)\//,
      router: /\/(router)\//,
      store: /\/(store|stores)\//,
      composables: /\/(composables|hooks)\//,
      utils: /\/(utils|lib|helpers)\//,
      assets: /\/(assets)\//,
      styles: /\/(styles|css)\//,
      types: /\/(types|interfaces)\//
    }
  },
  react: {
    name: 'React',
    icon: '⚛️',
    patterns: ['src/App.js', 'src/App.tsx', 'src/index.js', 'src/index.tsx'],
    packageIndicators: ['react'],
    directories: ['src'],
    categories: {
      components: /\/(components|ui)\//,
      pages: /\/(pages|views|screens)\//,
      hooks: /\/(hooks)\//,
      context: /\/(context|providers)\//,
      utils: /\/(utils|lib|helpers)\//,
      assets: /\/(assets)\//,
      styles: /\/(styles|css)\//,
      types: /\/(types|interfaces)\//,
      services: /\/(services|api)\//
    }
  }
};

// File extensions to count
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.graphql', '.md', '.mdx'
]);

// Directories to ignore
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  '.output', 'coverage', '.nyc_output', '.vscode', '.idea',
  '__pycache__', '.pytest_cache', 'logs', '.cache',
  'public', 'static', 'assets'
]);

// Files to ignore
const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.env', '.env.local', '.env.example',
  'next.config.js', 'nuxt.config.js', 'vue.config.js',
  'tailwind.config.js', 'postcss.config.js', 'vite.config.js'
]);

class ProjectScanner {
  constructor() {
    this.projects = [];
  }

  async scanForProjects(startDir = process.cwd(), maxDepth = 3) {
    const spinner = new Spinner('🔍 Scanning for projects...');
    spinner.start();

    try {
      await this.scanDirectory(startDir, 0, maxDepth);
      spinner.stop();
      
      if (this.projects.length === 0) {
        console.log(`${colors.yellow}⚠️  No projects found in ${startDir}${colors.reset}`);
        return [];
      }

      console.log(`${colors.green}✅ Found ${this.projects.length} project(s)${colors.reset}\n`);
      return this.projects;
    } catch (error) {
      spinner.stop();
      console.error(`${colors.red}❌ Error scanning for projects: ${error.message}${colors.reset}`);
      return [];
    }
  }

  async scanDirectory(dirPath, currentDepth, maxDepth) {
    if (currentDepth >= maxDepth) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      // Check if this directory is a project
      const framework = await this.detectFramework(dirPath);
      if (framework) {
        const projectName = path.basename(dirPath);
        this.projects.push({
          name: projectName,
          path: dirPath,
          framework: framework
        });
      }

      // Recursively scan subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          const fullPath = path.join(dirPath, entry.name);
          await this.scanDirectory(fullPath, currentDepth + 1, maxDepth);
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
    }
  }

  async detectFramework(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      const packageJsonPath = path.join(dirPath, 'package.json');
      
      let packageJson = null;
      try {
        const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(packageContent);
      } catch (error) {
        // No package.json or invalid JSON
      }

      for (const [key, framework] of Object.entries(FRAMEWORKS)) {
        // Check for config files
        const hasConfigFile = framework.patterns.some(pattern => 
          files.includes(path.basename(pattern))
        );

        // Check for package.json dependencies
        let hasPackageDep = false;
        if (packageJson) {
          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies
          };
          hasPackageDep = framework.packageIndicators.some(indicator =>
            Object.keys(allDeps).some(dep => dep.includes(indicator))
          );
        }

        // Check for typical directory structure
        const hasTypicalDirs = framework.directories.some(dir =>
          files.includes(dir)
        );

        if (hasConfigFile || hasPackageDep || hasTypicalDirs) {
          return framework;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }
}

class CodeCounter {
  constructor(framework) {
    this.framework = framework;
    this.stats = {
      totalFiles: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalBlankLines: 0,
      totalCommentLines: 0,
      fileTypes: {},
      categories: {},
      largestFiles: [],
      errors: []
    };
  }

  isCodeFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  }

  shouldIgnoreDir(dirName) {
    return IGNORE_DIRS.has(dirName) || dirName.startsWith('.');
  }

  shouldIgnoreFile(fileName) {
    return IGNORE_FILES.has(fileName) || fileName.startsWith('.') || fileName.endsWith('.min.js');
  }

  categorizeFile(filePath) {
    if (!this.framework) return 'other';
    
    for (const [category, pattern] of Object.entries(this.framework.categories)) {
      if (pattern.test(filePath)) {
        return category;
      }
    }
    return 'other';
  }

  countLines(content, filePath) {
    const lines = content.split('\n');
    let codeLines = 0;
    let commentLines = 0;
    let blankLines = 0;
    
    const ext = path.extname(filePath).toLowerCase();
    const isJsLike = ['.js', '.jsx', '.ts', '.tsx', '.vue'].includes(ext);
    const isCssLike = ['.css', '.scss', '.sass', '.less'].includes(ext);
    
    let inMultiLineComment = false;
    
    for (let line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine === '') {
        blankLines++;
        continue;
      }
      
      // Handle multi-line comments
      if (isJsLike || isCssLike) {
        if (inMultiLineComment) {
          commentLines++;
          if (trimmedLine.includes('*/')) {
            inMultiLineComment = false;
          }
          continue;
        }
        
        if (trimmedLine.startsWith('/*')) {
          commentLines++;
          if (!trimmedLine.includes('*/')) {
            inMultiLineComment = true;
          }
          continue;
        }
      }
      
      // Handle single-line comments
      if ((isJsLike && trimmedLine.startsWith('//')) ||
          (isCssLike && trimmedLine.startsWith('/*')) ||
          (['.html'].includes(ext) && trimmedLine.startsWith('<!--'))) {
        commentLines++;
        continue;
      }
      
      codeLines++;
    }
    
    return {
      total: lines.length,
      code: codeLines,
      comments: commentLines,
      blank: blankLines
    };
  }

  async scanDirectory(dirPath, basePath = dirPath, spinner) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);
        
        if (entry.isDirectory()) {
          if (!this.shouldIgnoreDir(entry.name)) {
            spinner.updateText(`📁 Scanning: ${relativePath}`);
            await this.scanDirectory(fullPath, basePath, spinner);
          }
        } else if (entry.isFile()) {
          if (!this.shouldIgnoreFile(entry.name) && this.isCodeFile(fullPath)) {
            spinner.updateText(`📄 Processing: ${relativePath}`);
            await this.processFile(fullPath, relativePath);
          }
        }
      }
    } catch (error) {
      this.stats.errors.push(`Error scanning directory ${dirPath}: ${error.message}`);
    }
  }

  async processFile(filePath, relativePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lineStats = this.countLines(content, filePath);
      const ext = path.extname(filePath).toLowerCase();
      const category = this.categorizeFile(relativePath);
      const fileSize = content.length;
      
      // Update overall stats
      this.stats.totalFiles++;
      this.stats.totalLines += lineStats.total;
      this.stats.totalCodeLines += lineStats.code;
      this.stats.totalBlankLines += lineStats.blank;
      this.stats.totalCommentLines += lineStats.comments;
      
      // Update file type stats
      if (!this.stats.fileTypes[ext]) {
        this.stats.fileTypes[ext] = {
          count: 0,
          lines: 0,
          codeLines: 0
        };
      }
      this.stats.fileTypes[ext].count++;
      this.stats.fileTypes[ext].lines += lineStats.total;
      this.stats.fileTypes[ext].codeLines += lineStats.code;
      
      // Update category stats
      if (!this.stats.categories[category]) {
        this.stats.categories[category] = {
          count: 0,
          lines: 0,
          codeLines: 0
        };
      }
      this.stats.categories[category].count++;
      this.stats.categories[category].lines += lineStats.total;
      this.stats.categories[category].codeLines += lineStats.code;
      
      // Track largest files
      this.stats.largestFiles.push({
        path: relativePath,
        lines: lineStats.total,
        codeLines: lineStats.code,
        size: fileSize,
        type: ext
      });
      
      // Keep only top 5 largest files
      if (this.stats.largestFiles.length > 5) {
        this.stats.largestFiles.sort((a, b) => b.lines - a.lines);
        this.stats.largestFiles = this.stats.largestFiles.slice(0, 5);
      }
      
    } catch (error) {
      this.stats.errors.push(`Error processing file ${filePath}: ${error.message}`);
    }
  }

  generateReport() {
    this.stats.largestFiles.sort((a, b) => b.lines - a.lines);
    
    return {
      summary: {
        totalFiles: this.stats.totalFiles,
        totalLines: this.stats.totalLines,
        totalCodeLines: this.stats.totalCodeLines,
        totalBlankLines: this.stats.totalBlankLines,
        totalCommentLines: this.stats.totalCommentLines,
        codeRatio: this.stats.totalLines > 0 ? 
          ((this.stats.totalCodeLines / this.stats.totalLines) * 100).toFixed(1) + '%' : '0%'
      },
      fileTypes: this.stats.fileTypes,
      categories: this.stats.categories,
      largestFiles: this.stats.largestFiles,
      errors: this.stats.errors
    };
  }
}

// CLI Helper functions
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function formatNumber(num) {
  return num.toLocaleString();
}

function printHeader() {
  console.log(`\n${colors.bright}${colors.blue}┌─────────────────────────────────────────┐${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}│  📊 Code Lines Counter CLI              │${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}└─────────────────────────────────────────┘${colors.reset}\n`);
}

function printSummary(report, framework, projectName) {
  const { summary } = report;
  
  console.log(`\n${colors.bright}${colors.green}🎯 Analysis Complete!${colors.reset}\n`);
  
  if (framework) {
    console.log(`${colors.cyan}Framework:${colors.reset} ${framework.icon} ${framework.name}`);
  }
  console.log(`${colors.cyan}Project:${colors.reset} ${projectName}\n`);
  
  console.log(`${colors.bright}📈 Summary Statistics:${colors.reset}`);
  console.log(`   Total Files:     ${colors.yellow}${formatNumber(summary.totalFiles)}${colors.reset}`);
  console.log(`   Total Lines:     ${colors.blue}${formatNumber(summary.totalLines)}${colors.reset}`);
  console.log(`   Code Lines:      ${colors.green}${formatNumber(summary.totalCodeLines)}${colors.reset}`);
  console.log(`   Comment Lines:   ${colors.gray}${formatNumber(summary.totalCommentLines)}${colors.reset}`);
  console.log(`   Blank Lines:     ${colors.gray}${formatNumber(summary.totalBlankLines)}${colors.reset}`);
  console.log(`   Code Ratio:      ${colors.magenta}${summary.codeRatio}${colors.reset}\n`);
}

function printFileTypes(fileTypes) {
  if (Object.keys(fileTypes).length === 0) return;
  
  console.log(`${colors.bright}📁 File Types:${colors.reset}`);
  
  const sortedTypes = Object.entries(fileTypes)
    .sort(([,a], [,b]) => b.codeLines - a.codeLines)
    .slice(0, 8);
    
  for (const [ext, stats] of sortedTypes) {
    console.log(`   ${ext.padEnd(8)} ${colors.yellow}${stats.count.toString().padStart(4)}${colors.reset} files  ${colors.blue}${formatNumber(stats.codeLines).padStart(8)}${colors.reset} lines`);
  }
  console.log();
}

function printCategories(categories, framework) {
  if (Object.keys(categories).length === 0 || !framework) return;
  
  console.log(`${colors.bright}🏗️  ${framework.name} Structure:${colors.reset}`);
  
  const sortedCategories = Object.entries(categories)
    .sort(([,a], [,b]) => b.codeLines - a.codeLines);
    
  for (const [category, stats] of sortedCategories) {
    console.log(`   ${category.padEnd(12)} ${colors.yellow}${stats.count.toString().padStart(4)}${colors.reset} files  ${colors.blue}${formatNumber(stats.codeLines).padStart(8)}${colors.reset} lines`);
  }
  console.log();
}

function printLargestFiles(largestFiles) {
  if (largestFiles.length === 0) return;
  
  console.log(`${colors.bright}📄 Largest Files:${colors.reset}`);
  
  for (const file of largestFiles) {
    console.log(`   ${colors.blue}${formatNumber(file.lines).padStart(6)}${colors.reset} lines  ${colors.gray}${file.path}${colors.reset}`);
  }
  console.log();
}

async function selectProject(projects) {
  if (projects.length === 1) {
    return projects[0];
  }
  
  console.log(`${colors.bright}📂 Found Projects:${colors.reset}\n`);
  
  projects.forEach((project, index) => {
    console.log(`   ${colors.yellow}${index + 1}.${colors.reset} ${project.framework.icon} ${colors.cyan}${project.name}${colors.reset} (${project.framework.name})`);
    console.log(`      ${colors.gray}${project.path}${colors.reset}\n`);
  });
  
  const rl = createInterface();
  let choice;
  
  while (true) {
    choice = await askQuestion(rl, `${colors.bright}Select project (1-${projects.length}): ${colors.reset}`);
    const index = parseInt(choice) - 1;
    
    if (index >= 0 && index < projects.length) {
      rl.close();
      return projects[index];
    }
    
    console.log(`${colors.red}❌ Invalid choice. Please enter a number between 1 and ${projects.length}.${colors.reset}`);
  }
}

async function main() {
  printHeader();
  
  const args = process.argv.slice(2);
  let targetDir = process.cwd();
  
  // Check if directory was provided as argument
  if (args.length > 0) {
    targetDir = path.resolve(args[0]);
    try {
      await fs.access(targetDir);
    } catch (error) {
      console.error(`${colors.red}❌ Directory not found: ${targetDir}${colors.reset}`);
      process.exit(1);
    }
  }
  
  // Scan for projects
  const scanner = new ProjectScanner();
  const projects = await scanner.scanForProjects(targetDir);
  
  if (projects.length === 0) {
    console.log(`${colors.yellow}💡 Try running in a directory containing web projects, or specify a path:${colors.reset}`);
    console.log(`   ${colors.gray}node server.js /path/to/projects${colors.reset}\n`);
    process.exit(0);
  }
  
  // Let user select project
  const selectedProject = await selectProject(projects);
  
  console.log(`${colors.green}✅ Selected: ${selectedProject.framework.icon} ${selectedProject.name}${colors.reset}\n`);
  
  // Count lines
  const counter = new CodeCounter(selectedProject.framework);
  const spinner = new Spinner('🔍 Analyzing project...');
  
  spinner.start();
  
  const startTime = Date.now();
  await counter.scanDirectory(selectedProject.path, selectedProject.path, spinner);
  const endTime = Date.now();
  
  spinner.stop();
  
  // Generate and display report
  const report = counter.generateReport();
  
  printSummary(report, selectedProject.framework, selectedProject.name);
  printFileTypes(report.fileTypes);
  printCategories(report.categories, selectedProject.framework);
  printLargestFiles(report.largestFiles);
  
  if (report.errors.length > 0) {
    console.log(`${colors.yellow}⚠️  Encountered ${report.errors.length} error(s) during scanning${colors.reset}\n`);
  }
  
  console.log(`${colors.gray}⏱️  Scan completed in ${endTime - startTime}ms${colors.reset}\n`);
}

// Run the CLI
if (require.main === module) {
  main().catch(error => {
    console.error(`${colors.red}❌ Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}

module.exports = { CodeCounter, ProjectScanner };