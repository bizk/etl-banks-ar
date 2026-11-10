package auth

import (
	"errors"
	"strconv"
	"time"

	"etl-banks-ar/internal/configs"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID uint   `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// defaultTokenLifetimeHours is long on purpose: an offline-first client may not reach the
// server for days and must still be able to push its queued changes when it does.
const defaultTokenLifetimeHours = 30 * 24

func tokenLifetime() time.Duration {
	hours, err := strconv.Atoi(configs.GetEnvOrDefault("JWT_EXPIRY_HOURS", ""))
	if err != nil || hours <= 0 {
		hours = defaultTokenLifetimeHours
	}
	return time.Duration(hours) * time.Hour
}

func GenerateToken(userID uint, email string) (string, error) {
	secret := configs.GetEnvOrDefault("JWT_SECRET", "your-secret-key")

	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(tokenLifetime())),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ValidateToken(tokenString string) (*Claims, error) {
	secret := configs.GetEnvOrDefault("JWT_SECRET", "your-secret-key")

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}
