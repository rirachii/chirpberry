import Foundation
import Security

enum AssistantKeychain {
    static let service = "com.rirachii.chirpberry.desktop.openai"
    static func read() throws -> String {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([kSecClass: kSecClassGenericPassword, kSecAttrService: service,
            kSecAttrAccount: "api-key", kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne] as CFDictionary, &result)
        if status == errSecItemNotFound { return "" }
        guard status == errSecSuccess, let data = result as? Data, let key = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "ChirpberryAssistantKeychain", code: Int(status))
        }
        return key
    }
    static func save(_ key: String) throws {
        let query = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: "api-key"] as CFDictionary
        if key.isEmpty {
            let status = SecItemDelete(query)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain: "ChirpberryAssistantKeychain", code: Int(status)) }
            return
        }
        let data = Data(key.utf8)
        var status = SecItemUpdate(query, [kSecValueData: data] as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd([kSecClass: kSecClassGenericPassword, kSecAttrService: service,
                kSecAttrAccount: "api-key", kSecValueData: data,
                kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: "ChirpberryAssistantKeychain", code: Int(status)) }
    }
}
