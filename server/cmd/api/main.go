package main

import (
	"log"

	"etl-banks-ar/internal/api"
	"etl-banks-ar/internal/configs"
	"etl-banks-ar/internal/db"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	// Run migrations
	db.Migrate()

	// Connect to database
	database := db.Connect()

	// Setup router
	router := api.SetupRouter(database)

	// Get port from env
	port := configs.GetEnvOrDefault("API_PORT", "8080")

	log.Printf("Starting API server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
