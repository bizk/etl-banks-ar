package main

import (
	"fmt"
	"log"

	"etl-banks-ar/internal/configs"
	"etl-banks-ar/internal/models"

	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	host := configs.GetEnvOrDefault("DB_HOST", "localhost")
	port := configs.GetEnvOrDefault("DB_PORT", "3306")
	user := configs.GetEnvOrDefault("DB_USER", "etluser")
	password := configs.GetEnvOrDefault("DB_PASSWORD", "etlpass")
	dbName := configs.GetEnvOrDefault("DB_NAME", "etl")

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		user, password, host, port, dbName)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	fmt.Println("Connected to database")

	// Migrate each model individually to see which fails
	models := []interface{}{
		&models.User{},
		&models.Workspace{},
		&models.WorkspaceMember{},
		&models.WorkspaceInvite{},
		&models.Transaction{},
	}

	names := []string{"User", "Workspace", "WorkspaceMember", "WorkspaceInvite", "Transaction"}

	for i, model := range models {
		fmt.Printf("Migrating %s...\n", names[i])
		if err := db.AutoMigrate(model); err != nil {
			log.Fatalf("Failed to migrate %s: %v", names[i], err)
		}
		fmt.Printf("  %s OK\n", names[i])
	}

	fmt.Println("All migrations complete!")
}
