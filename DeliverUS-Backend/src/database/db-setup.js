/**
 * Script robusto de setup y migraciones
 *
 * Maneja:
 * - Crear BD si no existe
 * - Deshacer migraciones anteriores
 * - Ejecutar migraciones
 * - Ejecutar seeders
 *
 * Uso: node src/database/db-setup.js
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') })

const execAsync = promisify(exec)

async function dbSetup () {
  try {
    console.log('🚀 Iniciando setup de BD...\n')

    // Step 1: Create database if it doesn't exist
    console.log('1️⃣  Verificando/creando BD...')

    const dbName = process.env.DATABASE_NAME || 'deliverus'
    const dbHost = process.env.DATABASE_HOST || 'localhost'
    const dbUser = process.env.DATABASE_USERNAME || 'root'
    const dbPort = process.env.DATABASE_PORT || '3306'
    const dbPass = process.env.DATABASE_PASSWORD || ''

    try {
      // Try db:create with sequelize-cli first
      await execAsync('npx sequelize-cli db:create')
      console.log('   ✅ BD creada exitosamente')
    } catch (err) {
      // For MariaDB/MySQL that doesn't support db:create, use mysql CLI
      if (err.message.includes('does not support db:create') || err.message.includes('Unknown database')) {
        console.log('   📦 Usando mysql CLI para crear BD...')
        try {
          // Use mysql command to create database
          // Using single quotes around password to properly handle special characters
          const cmd = `mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} -p'${dbPass}' -e "CREATE DATABASE IF NOT EXISTS ${dbName};"`
          await execAsync(cmd)
          console.log('   ✅ BD creada exitosamente')
        } catch (sqlErr) {
          console.log('   ⚠️  No se pudo crear la BD manualmente, intentando migraciones...')
        }
      } else if (err.message.includes('already exists')) {
        console.log('   ✅ BD ya existe')
      } else {
        console.log('   ⚠️  Continuando con las migraciones...')
      }
    }

    // Step 1.5: Clean orphaned migrations from SequelizeMeta before undoing
    console.log('\n1️⃣.5️⃣  Limpiando migraciones huérfanas del registro...')
    try {
      // Get all migrations in filesystem
      const migrationsOutput = await execAsync('ls -1 src/database/migrations/*.js 2>/dev/null | xargs -I {} basename {} || echo ""')
      const migrationsInFS = migrationsOutput.stdout
        .trim()
        .split('\n')
        .filter(f => f && !f.startsWith('config'))

      // Get all migrations in database
      const dbMigrationsOutput = await execAsync(`mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} -p'${dbPass}' ${dbName} -e "SELECT name FROM SequelizeMeta" --batch --skip-column-names 2>/dev/null || echo ""`)
      const dbMigrations = dbMigrationsOutput.stdout
        .trim()
        .split('\n')
        .filter(f => f)

      // Find orphaned migrations (in DB but not in filesystem)
      const orphanedMigrations = dbMigrations.filter(dbMig => !migrationsInFS.includes(dbMig))

      if (orphanedMigrations.length > 0) {
        console.log(`   🗑️  Encontradas ${orphanedMigrations.length} migraciones huérfanas`)
        for (const orphan of orphanedMigrations) {
          const deleteCmd = `mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} -p'${dbPass}' ${dbName} -e "DELETE FROM SequelizeMeta WHERE name = '${orphan}'"`
          await execAsync(deleteCmd)
          console.log(`   ✅ Eliminada: ${orphan}`)
        }
      } else {
        console.log('   ✅ Sin migraciones huérfanas')
      }
    } catch (cleanErr) {
      console.log('   ℹ️  No se pudo verificar migraciones huérfanas, continuando...')
    }

    // Step 1.6: Undo all migrations to clean data
    console.log('\n1️⃣.6️⃣  Deshaciendo migraciones anteriores...')
    try {
      await execAsync('npx sequelize-cli db:migrate:undo:all')
      console.log('   ✅ Migraciones revertidas correctamente')
    } catch (err) {
      // If there are no migrations to undo (fresh BD), this is expected
      if (err.message.includes('Unable to find') || err.message.includes('Migration not found')) {
        console.log('   ℹ️  BD nueva, sin migraciones previas')
      } else {
        console.log('   ⚠️  No se pudieron revertir todas las migraciones, continuando...')
      }
    }

    // Step 2: Run migrations
    console.log('\n2️⃣  Ejecutando migraciones...')
    try {
      await execAsync('npx sequelize-cli db:migrate')
      console.log('   ✅ Migraciones ejecutadas')
    } catch (err) {
      console.error('   ❌ Error en migraciones:', err.message)
      throw err
    }

    // Step 3: Run seeders
    console.log('\n3️⃣  Ejecutando seeders...')
    try {
      await execAsync('npx sequelize-cli db:seed:all')
      console.log('   ✅ Seeders ejecutados')
    } catch (err) {
      // Seeders can fail without breaking the setup
      console.warn('   ⚠️  Advertencia en seeders:', err.message)
    }

    console.log('\n✅ Setup completado exitosamente!')
  } catch (error) {
    console.error('\n❌ Error en setup:', error.message)
    process.exit(1)
  }
}

dbSetup()
