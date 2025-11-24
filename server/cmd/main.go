package main

import (
	"database/sql"
	"etl-banks-ar/internal/db"
	"etl-banks-ar/internal/models"
	"fmt"
	"log"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("Starting server...")

	if err := godotenv.Load(); err != nil {
		log.Fatal("Error load	ing .env file")
	}

	// result, err := ocr.Execute("resources/Extracto-Uala_Octubre.pdf")
	// if err != nil {
	// 	log.Fatal("Error executing OCR: ", err)
	// }

	db.Migrate()

	d := db.Connect()

	transaction := &models.Transaction{
		Date:         time.Now(),
		Description:  sql.NullString{String: "Test", Valid: true},
		Amount:       sql.NullFloat64{Float64: 100, Valid: true},
		BalanceAfter: sql.NullFloat64{Float64: 100, Valid: true},
		Type:         sql.NullString{String: "debit", Valid: true},
	}

	result := d.Create(transaction)
	if result.Error != nil {
		log.Fatalf("Error creating transaction: %v", result.Error)
	}

	fmt.Printf("Transaction created successfully! ID: %d\n", transaction.ID)

	// fmt.Println("Result: ", result)
}
