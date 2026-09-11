import Foundation
import Security

/// Startup checks only item metadata. Secret data is read after a user action.
/// The legacy login keychain also needs the process-wide UI guard: the modern
/// authentication-UI query option alone does not suppress every legacy prompt.
enum KeychainPresence {
    static func contains(service: String) throws -> Bool {
        var interactionAllowed = DarwinBoolean(false)
        var status = SecKeychainGetUserInteractionAllowed(&interactionAllowed)
        guard status == errSecSuccess else { throw NSError(domain: "ChirpberryKeychainPresence", code: Int(status)) }
        status = SecKeychainSetUserInteractionAllowed(false)
        guard status == errSecSuccess else { throw NSError(domain: "ChirpberryKeychainPresence", code: Int(status)) }
        // No suspension point: restore the helper's UI policy before any other command.
        defer { SecKeychainSetUserInteractionAllowed(interactionAllowed.boolValue) }
        var result: CFTypeRef?
        status = SecItemCopyMatching([kSecClass: kSecClassGenericPassword, kSecAttrService: service,
            kSecAttrAccount: "api-key", kSecReturnAttributes: true, kSecMatchLimit: kSecMatchLimitOne,
            kSecUseAuthenticationUI: kSecUseAuthenticationUIFail] as CFDictionary, &result)
        if status == errSecItemNotFound { return false }
        guard status == errSecSuccess else { throw NSError(domain: "ChirpberryKeychainPresence", code: Int(status)) }
        return true
    }
}
