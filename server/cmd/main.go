package main

import (
	"etl-banks-ar/internal/ocr"
	"fmt"
	"log"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("Starting server...")

	if err := godotenv.Load(); err != nil {
		log.Fatal("Error load	ing .env file")
	}

	ocr.Execute("bank-statement.pdf")
}
