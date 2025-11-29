package clasifier

import (
	"database/sql"
	"encoding/json"
	"etl-banks-ar/internal/models"
	"fmt"
	"math"
	"sort"
	"strconv"
)

const MIN_AVG_SIMILARITY = 0.1
const K = 5

func ClassifyTransactions(transactions []models.Transaction, classifiedTransactions []models.Transaction) ([]models.Transaction, error) {
	fmt.Println("Classifying transactions...")
	for _, transaction := range transactions {
		fmt.Println("Transaction: ", transaction.Description)
		neighbors, err := findKNearest(transaction, classifiedTransactions, K)
		if err != nil {
			return nil, err
		}
		category, averageSimilarity, success := classifyFromNeighbors(neighbors, MIN_AVG_SIMILARITY)
		fmt.Println("Category: ", category)
		fmt.Println("Average similarity: ", strconv.FormatFloat(averageSimilarity, 'f', -1, 64))
		fmt.Println("Success: ", success)
		transaction.Category = sql.NullString{String: category, Valid: true}
	}

	return transactions, nil
}

type Neighbor struct {
	ID         uint
	Similarity float64
	Category   string
}

func classifyFromNeighbors(neighbors []Neighbor, minAvgSimilarity float64) (string, float64, bool) {
	fmt.Println("Classifying from neighbors...")
	if len(neighbors) == 0 {
		return "", 0, false
	}

	var sum float64
	counts := make(map[string]int)
	for _, n := range neighbors {
		sum += n.Similarity  // To calculate the average similarity
		counts[n.Category]++ // To count the number of transactions for each category
	}
	avg := sum / float64(len(neighbors))

	var bestCategory string
	var bestCategoryCount int
	for category, count := range counts { // We iterate around the categories and we find the one with the most transactions
		if count > bestCategoryCount {
			bestCategoryCount = count
			bestCategory = category
		}
	}

	if avg < minAvgSimilarity {
		return "", avg, false
	}
	return bestCategory, avg, true
}

func findKNearest(transaction models.Transaction, classifiedTransactions []models.Transaction, k int) ([]Neighbor, error) {
	fmt.Println("Finding nearest neighbors...")
	neighbor := make([]Neighbor, 0)

	for _, classifiedTransaction := range classifiedTransactions {
		var embeddingA []float64
		var embeddingB []float64
		fmt.Println("classifiedTransaction: ", classifiedTransaction.Category)
		err := json.Unmarshal([]byte(transaction.EmbeddingJSON), &embeddingA)
		if err != nil {
			fmt.Println("Error unmarshalling embedding A: ", err)
			return nil, err
		}
		err = json.Unmarshal([]byte(classifiedTransaction.EmbeddingJSON), &embeddingB)
		if err != nil {
			fmt.Println("Error unmarshalling embedding B: ", err)
			return nil, err
		}
		similarity := cosineSimilarity(embeddingA, embeddingB)
		neighbor = append(neighbor, Neighbor{ID: classifiedTransaction.ID, Similarity: similarity, Category: classifiedTransaction.Category.String})
	}

	sort.Slice(neighbor, func(i, j int) bool {
		return neighbor[i].Similarity > neighbor[j].Similarity
	})
	fmt.Println("Neighbor: ", neighbor)

	if len(neighbor) > k {
		neighbor = neighbor[:k]
	}

	return neighbor[:k], nil
}

func cosineSimilarity(a, b []float64) float64 {
	return dotProduct(a, b) / (magnitude(a) * magnitude(b))
}

func dotProduct(a, b []float64) float64 {
	sum := 0.0
	for i := range a {
		sum += a[i] * b[i]
	}
	return sum
}

func magnitude(a []float64) float64 {
	sum := 0.0
	return math.Sqrt(sum)
}
