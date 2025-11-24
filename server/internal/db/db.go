package db

import (
	"fmt"

	"etl-banks-ar/internal/configs"
	"etl-banks-ar/internal/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func Connect() *gorm.DB {
	host := configs.GetEnvOrDefault("DB_HOST", "localhost")
	port := configs.GetEnvOrDefault("DB_PORT", "3306")
	user := configs.GetEnvOrDefault("DB_USER", "etluser")
	password := configs.GetEnvOrDefault("DB_PASSWORD", "etlpass")
	dbName := configs.GetEnvOrDefault("DB_NAME", "etl")

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		user, password, host, port, dbName)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		panic(fmt.Sprintf("failed to connect database: %v", err))
	}

	return db
}

func Migrate() {
	db := Connect()

	db.AutoMigrate(&models.Transaction{})
}
